import React, { useEffect, useState, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { spansStore, type SerializableSpan, initObservability } from '../lib/otel/instrumentation';

export default function ObservabilityHUD() {
    const spans = useStore(spansStore);
    const [selectedSpan, setSelectedSpan] = useState<SerializableSpan | null>(null);
    const [viewMode, setViewMode] = useState<'list' | 'waterfall'>('list');

    // Initialize OTel on mount (client-side only)
    useEffect(() => {
        try {
            initObservability();
        } catch (e) {
            console.error('[Observability] Init failed:', e);
        }
    }, []);

    // --- Traffic Generator ---
    useEffect(() => {
        const interval = setInterval(() => {
            // Generate random traffic
            const randomId = Math.floor(Math.random() * 200) + 1;
            fetch(`https://jsonplaceholder.typicode.com/todos/${randomId}`)
                .then(res => res.json())
                .catch(() => { }); // ignore errors
        }, 5000); // every 5 seconds

        return () => clearInterval(interval);
    }, []);

    // Process traces for Waterfall view
    const traces = useMemo(() => {
        if (viewMode !== 'waterfall') return [];

        const grouped = new Map<string, SerializableSpan[]>();
        spans.forEach(span => {
            const list = grouped.get(span.traceId) || [];
            list.push(span);
            grouped.set(span.traceId, list);
        });

        return Array.from(grouped.entries()).map(([traceId, traceSpans]) => {
            const start = Math.min(...traceSpans.map(s => s.startTime));
            const end = Math.max(...traceSpans.map(s => s.startTime + s.duration));
            const duration = end - start;

            // Sort spans: parents first, then by time
            // A simple topo sort or just time-based is often enough for simple waterfals
            const sorted = [...traceSpans].sort((a, b) => a.startTime - b.startTime);

            return { traceId, spans: sorted, start, duration };
        }).sort((a, b) => b.start - a.start); // Newest traces first
    }, [spans, viewMode]);

    // Sort spans by start time for the list view
    const sortedSpans = useMemo(() => {
        return [...spans].sort((a, b) => b.startTime - a.startTime); // Newest first
    }, [spans]);

    return (
        <div id="observability-hud" className="fixed inset-x-0 bottom-0 z-[9999] h-[50vh] bg-black/90 text-green-400 font-mono border-t border-green-500/30 backdrop-blur-md flex flex-col transition-transform duration-300 ease-out shadow-[0_-5px_20px_rgba(0,0,0,0.5)]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-green-500/20 bg-green-900/10 shrink-0">
                <div className="flex items-center gap-4">
                    <span className="font-bold flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                        SYSTEM_DIAGNOSTICS
                    </span>
                    <span className="text-xs text-green-500/60">TOTAL_SPANS: {spans.length}</span>
                </div>
                <div className="flex items-center gap-4 text-xs">
                    <button
                        onClick={() => setViewMode(m => m === 'list' ? 'waterfall' : 'list')}
                        className={`hover:text-green-300 transition-colors uppercase ${viewMode === 'waterfall' ? 'text-green-100 font-bold' : ''}`}
                    >
                        [{viewMode === 'list' ? 'SWITCH_TO_WATERFALL' : 'SWITCH_TO_LIST'}]
                    </button>
                    <button
                        onClick={() => {
                            spansStore.set([]);
                            sessionStorage.removeItem('otel_spans');
                            setSelectedSpan(null);
                        }}
                        className="hover:text-green-300 transition-colors uppercase"
                    >
                        [CLEAR_LOGS]
                    </button>
                    <span className="text-green-500/60">
                        AUTO_TRAFFIC: ON
                    </span>
                </div>
            </div>

            {/* Main Content Split */}
            <div className="flex-1 flex flex-row min-h-0 overflow-hidden">
                {/* List/Waterfall Area */}
                <div className="flex-1 overflow-y-auto p-0 relative border-r border-green-500/20">
                    {spans.length === 0 && <div className="text-center opacity-50 mt-10">WAITING FOR TELEMETRY...</div>}

                    {viewMode === 'list' ? (
                        <div className="flex flex-col">
                            {/* Table Header */}
                            <div className="grid grid-cols-[100px_1fr_100px_100px] gap-2 px-4 py-1 text-xs text-green-500/40 border-b border-green-500/10 bg-black/20 sticky top-0 backdrop-blur-sm z-10">
                                <div>TIME</div>
                                <div>OPERATION</div>
                                <div className="text-right">DURATION</div>
                                <div className="text-right">TRACE_ID</div>
                            </div>

                            {sortedSpans.map((span) => {
                                const isSelected = selectedSpan?.spanId === span.spanId;
                                return (
                                    <div
                                        key={`${span.spanId}-${span.startTime}`}
                                        className={`group grid grid-cols-[100px_1fr_100px_100px] gap-2 px-4 py-1 text-xs border-b border-green-500/5 items-center cursor-pointer transition-colors ${isSelected ? 'bg-green-500/20' : 'hover:bg-green-500/10'}`}
                                        onClick={() => setSelectedSpan(prev => prev?.spanId === span.spanId ? null : span)}
                                    >
                                        <div className="opacity-50 font-mono">{span.startTime.toFixed(0)}ms</div>
                                        <div className={`truncate font-bold transition-colors ${isSelected ? 'text-green-100' : 'text-green-300 group-hover:text-green-100'}`}>{span.name}</div>
                                        <div className="text-right text-xs opacity-70 font-mono">
                                            {span.duration.toFixed(2)}ms
                                        </div>
                                        <div className="text-right opacity-30 text-[10px] font-mono truncate">
                                            {span.traceId.slice(0, 6)}...
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    ) : (
                        // Waterfall View
                        <div className="p-4 space-y-6">
                            {traces.map((trace) => (
                                <div key={trace.traceId} className="border border-green-500/10 rounded overflow-hidden">
                                    <div className="bg-green-500/5 px-2 py-1 text-[10px] text-green-500/50 flex justify-between">
                                        <span>TRACE: {trace.traceId}</span>
                                        <span>{trace.duration.toFixed(2)}ms</span>
                                    </div>
                                    <div className="relative p-2 bg-black/40">
                                        {trace.spans.map((span, index) => {
                                            const offset = span.startTime - trace.start;
                                            const percentOffset = (offset / trace.duration) * 100;
                                            const percentWidth = Math.max((span.duration / trace.duration) * 100, 0.5); // min width 0.5%
                                            const isSelected = selectedSpan?.spanId === span.spanId;

                                            return (
                                                <div
                                                    key={span.spanId}
                                                    className={`relative h-6 mb-1 flex items-center group cursor-pointer ${isSelected ? 'bg-white/5' : 'hover:bg-white/5'}`}
                                                    onClick={() => setSelectedSpan(prev => prev?.spanId === span.spanId ? null : span)}
                                                >
                                                    <div className="absolute left-0 w-32 truncate text-[10px] px-2 z-10 text-green-300 drop-shadow-md">
                                                        {span.name}
                                                    </div>
                                                    {/* The Bar */}
                                                    <div
                                                        className={`absolute h-4 rounded-sm transition-all opacity-80 ${isSelected ? 'bg-green-400' : 'bg-green-600 group-hover:bg-green-500'}`}
                                                        style={{
                                                            left: `${percentOffset}%`,
                                                            width: `${percentWidth}%`,
                                                            minWidth: '2px'
                                                        }}
                                                    />
                                                    <div className="absolute right-2 text-[9px] opacity-40 font-mono text-green-500">
                                                        {span.duration.toFixed(2)}ms
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>



                {/* Detail Pane */}
                {selectedSpan && (
                    <div className="w-1/2 bg-black/50 p-4 text-xs overflow-y-auto shrink-0 border-l border-green-500/20 relative">
                        <button
                            onClick={() => setSelectedSpan(null)}
                            className="absolute top-2 right-2 text-green-500/50 hover:text-green-300 transition-colors"
                        >
                            [X]
                        </button>

                        <div className="grid grid-cols-[30%_70%] gap-4 mt-2">
                            <div>
                                <div className="text-green-500/50 mb-1">SPAN_DETAILS</div>
                                <div className="text-white mb-2 font-bold">{selectedSpan.name}</div>
                                <div className="grid gap-4 text-[10px] opacity-70">
                                    <div>ID: {selectedSpan.spanId}</div>
                                    <div>TRACE: {selectedSpan.traceId}</div>
                                    <div>PARENT: {selectedSpan.parentId || 'ROOT'}</div>
                                </div>
                            </div>
                            <div>
                                <div className="text-green-500/50 mb-1">ATTRIBUTES</div>
                                <pre className="text-green-300 whitespace-pre-wrap">{JSON.stringify(selectedSpan.attributes, null, 2)}</pre>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
