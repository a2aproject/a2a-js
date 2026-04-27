export type TransportProtocolName = 'JSONRPC' | 'HTTP+JSON' | 'GRPC' | (string & {});

export interface JSONRPCError {
  code: number;
  data?: Array<Record<string, unknown>> | { [k: string]: unknown };
  message: string;
}

export interface JSONRPCErrorResponse {
  error: JSONRPCError;
  id: string | number | null;
  jsonrpc: '2.0';
}
