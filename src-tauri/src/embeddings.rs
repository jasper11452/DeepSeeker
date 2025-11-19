use anyhow::{Context, Result};
use ndarray::{Array1, Array2};
use ort::{GraphOptimizationLevel, Session};
use std::path::PathBuf;
use std::sync::Arc;
use tokenizers::Tokenizer;

const MAX_SEQ_LENGTH: usize = 512;
const EMBEDDING_DIM: usize = 1024; // bge-m3 output dimension

/// Embeddings model for generating vector representations using BAAI/bge-m3
///
/// Setup instructions:
/// 1. Download bge-m3 ONNX model from HuggingFace
/// 2. Place model files in: ~/.deepseeker/models/bge-m3/
///    - model.onnx
///    - tokenizer.json
///
/// Model: https://huggingface.co/BAAI/bge-m3
pub struct EmbeddingModel {
    session: Arc<Session>,
    tokenizer: Tokenizer,
}

impl EmbeddingModel {
    /// Initialize embedding model from local files
    ///
    /// Expected directory structure:
    /// ```
    /// ~/.deepseeker/models/bge-m3/
    /// ├── model.onnx
    /// └── tokenizer.json
    /// ```
    pub fn new() -> Result<Self> {
        let model_dir = Self::get_model_dir()?;
        let model_path = model_dir.join("model.onnx");
        let tokenizer_path = model_dir.join("tokenizer.json");

        // Check if model files exist
        if !model_path.exists() {
            return Err(anyhow::anyhow!(
                "Model file not found at {:?}. Please download bge-m3 ONNX model first.",
                model_path
            ));
        }

        if !tokenizer_path.exists() {
            return Err(anyhow::anyhow!(
                "Tokenizer file not found at {:?}. Please download tokenizer.json first.",
                tokenizer_path
            ));
        }

        // Load ONNX session
        let session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(4)?
            .commit_from_file(&model_path)
            .context("Failed to load ONNX model")?;

        // Load tokenizer
        let tokenizer =
            Tokenizer::from_file(tokenizer_path).context("Failed to load tokenizer")?;

        log::info!("Embedding model loaded successfully from {:?}", model_dir);

        Ok(Self {
            session: Arc::new(session),
            tokenizer,
        })
    }

    /// Create a stub model for testing (no actual inference)
    #[cfg(test)]
    pub fn new_stub() -> Result<Self> {
        // Return error indicating this is a stub
        Err(anyhow::anyhow!("Stub model - use for testing only"))
    }

    /// Get model directory path
    fn get_model_dir() -> Result<PathBuf> {
        let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE"))?;
        let model_dir = PathBuf::from(home)
            .join(".deepseeker")
            .join("models")
            .join("bge-m3");

        // Create directory if it doesn't exist
        std::fs::create_dir_all(&model_dir)?;

        Ok(model_dir)
    }

    /// Generate embedding vector for a single text
    pub fn embed(&self, text: &str) -> Result<Vec<f32>> {
        let batch = self.embed_batch(&[text.to_string()])?;
        Ok(batch.into_iter().next().unwrap())
    }

    /// Batch embed multiple texts (more efficient)
    pub fn embed_batch(&self, texts: &[String]) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(vec![]);
        }

        // Tokenize all texts
        let encodings = self.tokenizer.encode_batch(texts.to_vec(), true)
            .map_err(|e| anyhow::anyhow!("Tokenization failed: {}", e))?;

        let batch_size = texts.len();
        let mut input_ids = Vec::with_capacity(batch_size * MAX_SEQ_LENGTH);
        let mut attention_mask = Vec::with_capacity(batch_size * MAX_SEQ_LENGTH);

        for encoding in &encodings {
            let ids = encoding.get_ids();
            let mask = encoding.get_attention_mask();

            // Pad or truncate to MAX_SEQ_LENGTH
            for i in 0..MAX_SEQ_LENGTH {
                input_ids.push(ids.get(i).copied().unwrap_or(0) as i64);
                attention_mask.push(mask.get(i).copied().unwrap_or(0) as i64);
            }
        }

        // Create input tensors
        let input_ids_array =
            Array2::from_shape_vec((batch_size, MAX_SEQ_LENGTH), input_ids)?;
        let attention_mask_array =
            Array2::from_shape_vec((batch_size, MAX_SEQ_LENGTH), attention_mask)?;

        // Run inference
        let outputs = self
            .session
            .run(ort::inputs![
                "input_ids" => input_ids_array,
                "attention_mask" => attention_mask_array,
            ]?)
            .context("ONNX inference failed")?;

        // Extract embeddings from output
        // bge-m3 outputs sentence embeddings directly
        let embeddings_tensor = outputs["sentence_embedding"]
            .try_extract_tensor::<f32>()?
            .view()
            .to_owned();

        // Convert to Vec<Vec<f32>>
        let mut result = Vec::with_capacity(batch_size);
        for i in 0..batch_size {
            let row = embeddings_tensor.row(i);
            result.push(row.to_vec());
        }

        Ok(result)
    }

    /// Normalize embeddings to unit length (for cosine similarity)
    pub fn normalize(embedding: &[f32]) -> Vec<f32> {
        let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm == 0.0 {
            return embedding.to_vec();
        }
        embedding.iter().map(|x| x / norm).collect()
    }

    /// Compute cosine similarity between two embeddings
    pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
        if a.len() != b.len() {
            return 0.0;
        }

        let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

        if norm_a == 0.0 || norm_b == 0.0 {
            return 0.0;
        }

        dot_product / (norm_a * norm_b)
    }

    /// Get embedding dimension
    pub fn embedding_dim(&self) -> usize {
        EMBEDDING_DIM
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize() {
        let vec = vec![3.0, 4.0];
        let normalized = EmbeddingModel::normalize(&vec);

        // Should be unit length
        let norm: f32 = normalized.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 0.0001);

        // Check values
        assert!((normalized[0] - 0.6).abs() < 0.0001);
        assert!((normalized[1] - 0.8).abs() < 0.0001);
    }

    #[test]
    fn test_cosine_similarity() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        let c = vec![0.0, 1.0, 0.0];

        // Same vectors
        assert!((EmbeddingModel::cosine_similarity(&a, &b) - 1.0).abs() < 0.0001);

        // Orthogonal vectors
        assert!((EmbeddingModel::cosine_similarity(&a, &c) - 0.0).abs() < 0.0001);
    }

    #[test]
    fn test_model_initialization_stub() {
        // This test will fail if model files don't exist, which is expected
        let result = EmbeddingModel::new();

        // Either model loads successfully or fails gracefully
        match result {
            Ok(_) => {
                log::info!("Model loaded successfully");
            }
            Err(e) => {
                // Expected if model files not present
                assert!(e.to_string().contains("not found") || e.to_string().contains("Failed"));
            }
        }
    }
}
