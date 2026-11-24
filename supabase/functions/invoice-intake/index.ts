import { createHandler } from './handler.mjs';
// pdf-lib (MIT): an invoice of several originals is sent to QuickBooks as one PDF of its pages (B-3, 2026-11-23).
import { PDFDocument } from 'npm:pdf-lib@1.17.1';
const runtime = (globalThis as any).EdgeRuntime;
Deno.serve(createHandler({ env: (key: string) => Deno.env.get(key), PDFDocument,
  background: (p: Promise<unknown>) => (runtime && typeof runtime.waitUntil === 'function' ? runtime.waitUntil(p) : p) }));
