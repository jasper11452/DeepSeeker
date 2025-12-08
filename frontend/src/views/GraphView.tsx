import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Network, RefreshCw, Loader2, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { graphApi, GraphNode } from '../lib/api';
import ForceGraph2D, { ForceGraphMethods } from 'react-force-graph-2d';
import { useThemeStore } from '../lib/store';

export function GraphView() {
    const navigate = useNavigate();
    const fgRef = useRef<ForceGraphMethods>();
    const containerRef = useRef<HTMLDivElement>(null);
    const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
    const { theme } = useThemeStore();

    // Compute dark mode
    const [isDarkMode, setIsDarkMode] = useState(false);
    useEffect(() => {
        const checkDark = () => {
            if (theme === 'dark') return true;
            if (theme === 'light') return false;
            return window.matchMedia('(prefers-color-scheme: dark)').matches;
        };
        setIsDarkMode(checkDark());
    }, [theme]);

    // Resize observer
    useEffect(() => {
        const updateDimensions = () => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight
                });
            }
        };

        window.addEventListener('resize', updateDimensions);
        updateDimensions();

        // Initial delay to ensure container is ready
        setTimeout(updateDimensions, 100);

        return () => window.removeEventListener('resize', updateDimensions);
    }, []);

    // Fetch graph data
    const { data: rawGraphData, isLoading, refetch } = useQuery({
        queryKey: ['graph'],
        queryFn: () => graphApi.getGraph(500), // Increase limit for better graph
    });

    // Transform data for react-force-graph
    const graphData = useMemo(() => {
        if (!rawGraphData) return { nodes: [], links: [] };
        return {
            nodes: rawGraphData.nodes.map(n => ({ ...n })), // Clone to avoid mutation issues
            links: rawGraphData.edges.map(e => ({ ...e }))
        };
    }, [rawGraphData]);

    // Build graph mutation
    const buildMutation = useMutation({
        mutationFn: (threshold: number) => graphApi.buildGraph(threshold),
        onSuccess: () => refetch(),
    });

    // Node click handler
    const handleNodeClick = useCallback((node: any) => {
        setSelectedNode(node);
        // Center view on node
        fgRef.current?.centerAt(node.x, node.y, 1000);
        fgRef.current?.zoom(2, 2000);
    }, []);

    // Node double click (navigate)
    const handleNodeRightClick = useCallback((node: any) => {
        if (node.file_type && node.metadata?.document_id) {
            navigate(`/document/${node.metadata.document_id}`);
        }
    }, [navigate]);

    // Custom node renderer
    const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const label = node.label;
        const fontSize = 12 / globalScale;
        const radius = 5;
        const isSelected = selectedNode?.id === node.id;

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI, false);
        ctx.fillStyle = isSelected ? '#3b82f6' : (isDarkMode ? '#60a5fa' : '#4f46e5');
        ctx.fill();

        // Selection ring
        if (isSelected) {
            ctx.beginPath();
            ctx.arc(node.x, node.y, radius + 2, 0, 2 * Math.PI, false);
            ctx.strokeStyle = '#2563eb';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Label
        if (globalScale > 0.8 || isSelected) {
            ctx.font = `${fontSize}px Sans-Serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = isDarkMode ? '#e5e7eb' : '#374151';
            // Draw background for text to make it readable
            const textWidth = ctx.measureText(label).width;
            ctx.fillStyle = isDarkMode ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.8)';
            ctx.fillRect(node.x - textWidth / 2 - 2, node.y + radius + 2, textWidth + 4, fontSize + 4);

            ctx.fillStyle = isDarkMode ? '#e5e7eb' : '#374151';
            ctx.fillText(label, node.x, node.y + radius + fontSize);
        }
    }, [selectedNode, isDarkMode]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-white dark:bg-dark-primary">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-default z-10 bg-white dark:bg-dark-primary relative shadow-sm">
                <div className="flex items-center gap-3">
                    <Network className="w-6 h-6 text-accent-primary" />
                    <div>
                        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
                            知识图谱
                        </h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            {rawGraphData?.total_nodes || 0} 个节点，{rawGraphData?.total_edges || 0} 条连接
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center bg-gray-100 dark:bg-dark-tertiary rounded-lg p-1 mr-2">
                        <button
                            onClick={() => {
                                const k = fgRef.current?.zoom() || 1;
                                fgRef.current?.zoom(k * 1.5, 400);
                            }}
                            className="p-1.5 hover:bg-white dark:hover:bg-dark-elevated rounded-md transition-colors"
                            title="Zoom In"
                        >
                            <ZoomIn className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        </button>
                        <button
                            onClick={() => {
                                const k = fgRef.current?.zoom() || 1;
                                fgRef.current?.zoom(k / 1.5, 400);
                            }}
                            className="p-1.5 hover:bg-white dark:hover:bg-dark-elevated rounded-md transition-colors"
                            title="Zoom Out"
                        >
                            <ZoomOut className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        </button>
                        <button
                            onClick={() => fgRef.current?.zoomToFit(400)}
                            className="p-1.5 hover:bg-white dark:hover:bg-dark-elevated rounded-md transition-colors"
                            title="Fit View"
                        >
                            <Maximize className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                        </button>
                    </div>

                    <button
                        onClick={() => buildMutation.mutate(0.5)}
                        disabled={buildMutation.isPending}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-accent-primary hover:bg-accent-secondary rounded-lg transition-colors disabled:opacity-50"
                    >
                        {buildMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <RefreshCw className="w-4 h-4" />
                        )}
                        重建图谱
                    </button>
                </div>
            </div>

            {/* Graph Canvas */}
            <div ref={containerRef} className="flex-1 relative overflow-hidden bg-gray-50 dark:bg-dark-secondary">
                <ForceGraph2D
                    ref={fgRef}
                    width={dimensions.width}
                    height={dimensions.height}
                    graphData={graphData}
                    nodeLabel="label"
                    nodeColor={node => selectedNode?.id === node.id ? '#3b82f6' : '#6366f1'}
                    nodeRelSize={6}
                    linkColor={() => isDarkMode ? '#4b5563' : '#d1d5db'}
                    linkDirectionalParticles={2}
                    linkDirectionalParticleSpeed={d => d.value * 0.001}
                    onNodeClick={handleNodeClick}
                    onNodeRightClick={handleNodeRightClick} // Using right click for navigation as single click is select
                    onBackgroundClick={() => setSelectedNode(null)}
                    nodeCanvasObject={paintNode}
                    cooldownTicks={100}
                    d3AlphaDecay={0.02}
                    d3VelocityDecay={0.3}
                />

                {/* Legend / Info */}
                <div className="absolute bottom-4 left-4 pointer-events-none">
                    <div className="bg-white/90 dark:bg-dark-elevated/90 backdrop-blur border border-default rounded-lg shadow-lg p-3 max-w-xs pointer-events-auto">
                        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">交互指南</h4>
                        <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                            <li>• 左键单击: 选中节点并聚焦</li>
                            <li>• 右键单击: 跳转到文档</li>
                            <li>• 滚轮: 缩放画布</li>
                            <li>• 拖拽: 移动视口/节点</li>
                        </ul>
                    </div>
                </div>

                {/* Selected Node Details */}
                {selectedNode && (
                    <div className="absolute top-4 right-4 bg-white dark:bg-dark-elevated border border-default rounded-lg shadow-lg p-4 w-64 animate-in slide-in-from-right-10 pointer-events-auto">
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-2 break-words">
                            {selectedNode.label}
                        </h3>
                        <div className="space-y-2 text-xs text-gray-600 dark:text-gray-400">
                            <div className="flex justify-between">
                                <span className="text-gray-500">类型</span>
                                <span>{selectedNode.type}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">文件类型</span>
                                <span>{selectedNode.file_type || '-'}</span>
                            </div>
                            {selectedNode.metadata?.chunk_index !== undefined && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500">分块索引</span>
                                    <span>#{String(selectedNode.metadata.chunk_index)}</span>
                                </div>
                            )}

                            <button
                                onClick={() => handleNodeRightClick(selectedNode)} // Reuse navigation
                                className="w-full mt-3 px-3 py-1.5 bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 rounded transition-colors text-center font-medium"
                            >
                                打开文档
                            </button>
                        </div>
                    </div>
                )}

                {graphData.nodes.length === 0 && !isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="text-center bg-white/50 dark:bg-black/50 p-6 rounded-2xl backdrop-blur">
                            <Network className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                            <p className="text-gray-600 dark:text-gray-300">暂无图谱数据</p>
                            <p className="text-xs text-gray-500 mt-1">点击右上角"重建图谱"开始分析</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}


