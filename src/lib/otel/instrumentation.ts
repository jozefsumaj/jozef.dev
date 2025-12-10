import 'zone.js';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { UserInteractionInstrumentation } from '@opentelemetry/instrumentation-user-interaction';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_USER_AGENT_ORIGINAL } from '@opentelemetry/semantic-conventions';
import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { atom } from 'nanostores';

// --- Global Store for Spans (The "Local Loopback") ---
export type SerializableSpan = {
    traceId: string;
    spanId: string;
    parentId?: string;
    name: string;
    startTime: number; // relative to something or absolute? hrTime
    duration: number; // in ms
    attributes: Record<string, any>;
    status: { code: number; message?: string };
};

export const spansStore = atom<SerializableSpan[]>([]);

if (typeof window !== 'undefined') {
    // Load from sessionStorage
    try {
        const saved = sessionStorage.getItem('otel_spans');
        if (saved) {
            spansStore.set(JSON.parse(saved));
        }
    } catch (e) {
        console.error('Failed to load spans from sessionStorage', e);
    }

    // Save to sessionStorage on change
    spansStore.subscribe((spans) => {
        try {
            sessionStorage.setItem('otel_spans', JSON.stringify(spans));
        } catch (e) {
            // ignore
        }
    });
}


// --- Custom Exporter ---
class LocalVisualizerExporter implements SpanExporter {
    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
        const serializableSpans: SerializableSpan[] = spans.map((span) => ({
            traceId: span.spanContext().traceId,
            spanId: span.spanContext().spanId,
            parentId: (span as any).parentSpanId || (span as any).parentSpanContext?.spanId,
            name: span.name,
            startTime: hrTimeToMilliseconds(span.startTime),
            duration: hrTimeToMilliseconds(span.duration),
            attributes: span.attributes,
            status: span.status,
        }));

        // Update the store (append new spans)
        // efficient append?
        const current = spansStore.get();
        // cap at 500 spans to avoid memory leaks in long sessions
        const newSpans = [...current, ...serializableSpans].slice(-500);
        spansStore.set(newSpans);

        resultCallback({ code: ExportResultCode.SUCCESS });
    }

    shutdown(): Promise<void> {
        return Promise.resolve();
    }
}

function hrTimeToMilliseconds(hrTime: [number, number]): number {
    return hrTime[0] * 1000 + hrTime[1] / 1e6;
}

// --- Initialization Logic ---
let initialized = false;

// ... imports

export function initObservability() {
    if (typeof window === 'undefined' || initialized) return;
    initialized = true;

    const provider = new WebTracerProvider({
        resource: resourceFromAttributes({
            [ATTR_SERVICE_NAME]: 'jozef.dev-client',
            [ATTR_USER_AGENT_ORIGINAL]: navigator.userAgent,
        }),
        spanProcessors: [
            new SimpleSpanProcessor(new LocalVisualizerExporter()),
        ],
    });

    provider.register({
        contextManager: new ZoneContextManager(),
    });

    registerInstrumentations({
        instrumentations: [
            new DocumentLoadInstrumentation(),
            new UserInteractionInstrumentation({
                eventNames: ['click', 'submit', 'keypress'],
                shouldPreventSpanCreation: (eventType, element, span) => {
                    const hud = document.getElementById('observability-hud');
                    return hud ? hud.contains(element) : false;
                },
            }),
            new FetchInstrumentation(),
        ],
    });

    console.log('👁️ [O11y] Introspective Website Initialized');
}
