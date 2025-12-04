import { HTTP_EXTENSION_HEADER, HTTP_VERSION_HEADER } from "./constants.js";

export type TransportProtocolName = 'JSONRPC' | 'HTTP+JSON' | 'GRPC' | (string & {});

export type ServiceParametersHeader = typeof HTTP_EXTENSION_HEADER | typeof HTTP_VERSION_HEADER | (string & {});

