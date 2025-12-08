#!/usr/bin/env python3
"""
测试 Vision Model 加载和推理
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image, ImageDraw, ImageFont
import tempfile

def test_vision_model():
    """测试 Vision Model"""
    print("=" * 60)
    print("Vision Model 测试 (macOS 优化版)")
    print("=" * 60)
    
    # 导入 model_manager
    from app.services.model_manager import model_manager
    import platform
    
    print(f"\n系统: {platform.system()}")
    print(f"平台: {platform.platform()}")
    
    print("\n1. 加载 Vision Model...")
    try:
        model, processor, is_mlx = model_manager.get_vision_model()
        print(f"   ✅ Vision Model 加载成功!")
        print(f"   - 使用 MLX: {is_mlx}")
        print(f"   - Model 类型: {type(model).__name__}")
        print(f"   - Processor 类型: {type(processor).__name__}")
    except Exception as e:
        print(f"   ❌ Vision Model 加载失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    
    print("\n2. 创建测试图片...")
    # 创建一个简单的测试图片（带文字）
    img = Image.new('RGB', (400, 200), color='white')
    draw = ImageDraw.Draw(img)
    
    # 绘制一些文字
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 24)
    except:
        try:
            font = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 24)
        except:
            font = ImageFont.load_default()
    
    draw.text((50, 50), "Hello, World!", fill='black', font=font)
    draw.text((50, 100), "Test Image - OCR", fill='blue', font=font)
    
    # 保存为临时文件
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp_file:
        temp_path = tmp_file.name
        img.save(tmp_file, format='PNG')
    
    print(f"   ✅ 测试图片创建成功! ({temp_path})")
    
    print("\n3. 测试图片描述推理...")
    try:
        prompt_text = "描述这张图片的内容，包括文字。"
        
        if is_mlx:
            # MLX-VLM 流程
            from mlx_vlm import generate
            
            # 构建带图片标记的 prompt
            formatted_prompt = processor.apply_chat_template(
                [{"role": "user", "content": f"<|vision_start|><|image_pad|><|vision_end|>{prompt_text}"}],
                tokenize=False,
                add_generation_prompt=True
            )
            
            print(f"   使用 MLX-VLM 推理...")
            response = generate(
                model, 
                processor, 
                formatted_prompt,
                image=temp_path,
                max_tokens=256,
                temperature=0.3
            )
            
            # 提取文本结果
            if hasattr(response, 'text'):
                result = response.text
            else:
                result = str(response)
                
            print(f"   ✅ 推理成功!")
            print(f"   - 输出: {result[:300]}...")
        else:
            # HunyuanOCR (Transformers) 流程
            import torch
            
            messages = [
                {
                    "role": "user", 
                    "content": [
                        {"type": "image", "image": img},
                        {"type": "text", "text": prompt_text}
                    ]
                }
            ]
            
            text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            inputs = processor(
                text=[text],
                images=img,
                padding=True,
                return_tensors="pt"
            )
            
            device = next(model.parameters()).device
            inputs = {k: v.to(device) for k, v in inputs.items()}
            
            with torch.no_grad():
                generated_ids = model.generate(
                    **inputs, 
                    max_new_tokens=256, 
                    do_sample=False
                )
            
            generated_text = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
            print(f"   ✅ 推理成功!")
            print(f"   - 输出: {generated_text[:300]}...")
            
    except Exception as e:
        import traceback
        print(f"   ❌ 推理失败: {e}")
        traceback.print_exc()
        return False
    finally:
        # 清理临时文件
        if os.path.exists(temp_path):
            os.unlink(temp_path)
    
    print("\n" + "=" * 60)
    print("✅ 所有测试通过!")
    print("=" * 60)
    return True

if __name__ == "__main__":
    success = test_vision_model()
    sys.exit(0 if success else 1)
