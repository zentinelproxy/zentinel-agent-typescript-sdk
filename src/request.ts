/**
 * Request wrapper for ergonomic access to HTTP request data.
 */

import { RequestHeadersEvent, RequestMetadata } from "./protocol.js";

export class Request {
  private readonly _event: RequestHeadersEvent;
  private readonly _body: Buffer;
  private readonly _parsedUrl: URL;
  private _queryParams: URLSearchParams | null = null;

  constructor(event: RequestHeadersEvent, body?: Buffer) {
    this._event = event;
    this._body = body || Buffer.alloc(0);
    // Parse URL - handle relative URIs by using a dummy base
    this._parsedUrl = new URL(event.uri, "http://localhost");
  }

  get metadata(): RequestMetadata {
    return this._event.metadata;
  }

  get correlationId(): string {
    return this._event.metadata.correlationId;
  }

  get clientIp(): string {
    return this._event.metadata.clientIp;
  }

  get method(): string {
    return this._event.method;
  }

  isGet(): boolean {
    return this._event.method.toUpperCase() === "GET";
  }

  isPost(): boolean {
    return this._event.method.toUpperCase() === "POST";
  }

  isPut(): boolean {
    return this._event.method.toUpperCase() === "PUT";
  }

  isDelete(): boolean {
    return this._event.method.toUpperCase() === "DELETE";
  }

  isPatch(): boolean {
    return this._event.method.toUpperCase() === "PATCH";
  }

  get uri(): string {
    return this._event.uri;
  }

  get path(): string {
    return this._event.uri;
  }

  get pathOnly(): string {
    return this._parsedUrl.pathname;
  }

  get queryString(): string {
    return this._parsedUrl.search.slice(1); // Remove leading '?'
  }

  private getQueryParams(): URLSearchParams {
    if (this._queryParams === null) {
      this._queryParams = this._parsedUrl.searchParams;
    }
    return this._queryParams;
  }

  query(name: string): string | null {
    return this.getQueryParams().get(name);
  }

  queryAll(name: string): string[] {
    return this.getQueryParams().getAll(name);
  }

  pathStartsWith(prefix: string): boolean {
    return this.pathOnly.startsWith(prefix);
  }

  pathEquals(path: string): boolean {
    return this.pathOnly === path;
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

  get host(): string | null {
    return this.header("host");
  }

  get userAgent(): string | null {
    return this.header("user-agent");
  }

  get contentType(): string | null {
    return this.header("content-type");
  }

  get authorization(): string | null {
    return this.header("authorization");
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

  get body(): Buffer {
    return this._body;
  }

  get bodyStr(): string {
    return this._body.toString("utf-8");
  }

  bodyJson<T = unknown>(): T {
    return JSON.parse(this._body.toString("utf-8")) as T;
  }

  withBody(body: Buffer): Request {
    return new Request(this._event, body);
  }

  toString(): string {
    return `Request(${this.method} ${this.path})`;
  }
}
