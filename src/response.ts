/**
 * Response wrapper for ergonomic access to HTTP response data.
 */

import { ResponseHeadersEvent } from "./protocol.js";

export class Response {
  private readonly _event: ResponseHeadersEvent;
  private readonly _body: Buffer;

  constructor(event: ResponseHeadersEvent, body?: Buffer) {
    this._event = event;
    this._body = body || Buffer.alloc(0);
  }

  get correlationId(): string {
    return this._event.correlationId;
  }

  get statusCode(): number {
    return this._event.status;
  }

  isSuccess(): boolean {
    return this._event.status >= 200 && this._event.status < 300;
  }

  isRedirect(): boolean {
    return this._event.status >= 300 && this._event.status < 400;
  }

  isClientError(): boolean {
    return this._event.status >= 400 && this._event.status < 500;
  }

  isServerError(): boolean {
    return this._event.status >= 500 && this._event.status < 600;
  }

  isError(): boolean {
    return this._event.status >= 400;
  }

  get headers(): Record<string, string[]> {
    return this._event.headers;
  }

  header(name: string): string | null {
    const nameLower = name.toLowerCase();
    for (const [key, values] of Object.entries(this._event.headers)) {
      if (key.toLowerCase() === nameLower && values.length > 0) {
        return values[0];
      }
    }
    return null;
  }

  headerAll(name: string): string[] {
    const nameLower = name.toLowerCase();
    for (const [key, values] of Object.entries(this._event.headers)) {
      if (key.toLowerCase() === nameLower) {
        return values;
      }
    }
    return [];
  }

  hasHeader(name: string): boolean {
    const nameLower = name.toLowerCase();
    return Object.keys(this._event.headers).some((key) => key.toLowerCase() === nameLower);
  }

  get contentType(): string | null {
    return this.header("content-type");
  }

  get location(): string | null {
    return this.header("location");
  }

  get contentLength(): number | null {
    const value = this.header("content-length");
    if (value === null) {
      return null;
    }
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }

  isJson(): boolean {
    const ct = this.contentType;
    if (ct === null) {
      return false;
    }
    return ct.toLowerCase().includes("application/json");
  }

  isHtml(): boolean {
    const ct = this.contentType;
    if (ct === null) {
      return false;
    }
    return ct.toLowerCase().includes("text/html");
  }

  get body(): Buffer {
    return this._body;
  }

  get bodyStr(): string {
    return this._body.toString("utf-8");
  }

  bodyJson<T = unknown>(): T {
    return JSON.parse(this._body.toString("utf-8")) as T;
  }

  withBody(body: Buffer): Response {
    return new Response(this._event, body);
  }

  toString(): string {
    return `Response(${this.statusCode})`;
  }
}
