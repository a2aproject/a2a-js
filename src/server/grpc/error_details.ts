/**
 * Utilities for encoding google.rpc.Status and google.rpc.ErrorInfo
 * into the `grpc-status-details-bin` metadata per §10.6.
 *
 * Uses manual protobuf encoding to avoid a dependency on google.rpc proto
 * definitions. The wire format for these well-known types is stable.
 */

import * as grpc from '@grpc/grpc-js';
import { A2A_ERROR_DOMAIN, A2A_ERROR_REASON, ERROR_INFO_TYPE } from '../../errors.js';

// Protobuf wire type constants
const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_LENGTH_DELIMITED = 2;

function makeTag(fieldNumber: number, wireType: number): number {
  return (fieldNumber << 3) | wireType;
}

function encodeVarint(value: number): Buffer {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return Buffer.from(bytes);
}

function encodeString(fieldNumber: number, value: string): Buffer {
  const strBuf = Buffer.from(value, 'utf-8');
  return Buffer.concat([
    encodeVarint(makeTag(fieldNumber, WIRE_TYPE_LENGTH_DELIMITED)),
    encodeVarint(strBuf.length),
    strBuf,
  ]);
}

function encodeBytes(fieldNumber: number, value: Buffer): Buffer {
  return Buffer.concat([
    encodeVarint(makeTag(fieldNumber, WIRE_TYPE_LENGTH_DELIMITED)),
    encodeVarint(value.length),
    value,
  ]);
}

function encodeVarintField(fieldNumber: number, value: number): Buffer {
  return Buffer.concat([encodeVarint(makeTag(fieldNumber, WIRE_TYPE_VARINT)), encodeVarint(value)]);
}

/**
 * Encodes a google.rpc.ErrorInfo protobuf message.
 *
 * Proto definition (google/rpc/error_details.proto):
 * ```
 * message ErrorInfo {
 *   string reason = 1;
 *   string domain = 2;
 *   map<string, string> metadata = 3;
 * }
 * ```
 */
function encodeErrorInfo(
  reason: string,
  domain: string,
  metadata?: Record<string, string>
): Buffer {
  const parts: Buffer[] = [encodeString(1, reason), encodeString(2, domain)];

  if (metadata) {
    for (const [key, value] of Object.entries(metadata)) {
      // map entries are encoded as embedded messages: field 3, with key=1, value=2
      const entryContent = Buffer.concat([encodeString(1, key), encodeString(2, value)]);
      parts.push(encodeBytes(3, entryContent));
    }
  }

  return Buffer.concat(parts);
}

/**
 * Encodes a google.protobuf.Any message wrapping ErrorInfo.
 *
 * Proto definition (google/protobuf/any.proto):
 * ```
 * message Any {
 *   string type_url = 1;
 *   bytes value = 2;
 * }
 * ```
 */
function encodeAny(typeUrl: string, value: Buffer): Buffer {
  return Buffer.concat([encodeString(1, typeUrl), encodeBytes(2, value)]);
}

/**
 * Encodes a google.rpc.Status protobuf message.
 *
 * Proto definition (google/rpc/status.proto):
 * ```
 * message Status {
 *   int32 code = 1;
 *   string message = 2;
 *   repeated google.protobuf.Any details = 3;
 * }
 * ```
 */
function encodeStatus(code: number, message: string, details: Buffer[]): Buffer {
  const parts: Buffer[] = [encodeVarintField(1, code), encodeString(2, message)];

  for (const detail of details) {
    parts.push(encodeBytes(3, detail));
  }

  return Buffer.concat(parts);
}

/**
 * Builds gRPC trailing metadata containing `grpc-status-details-bin`
 * with an encoded `google.rpc.Status` carrying a `google.rpc.ErrorInfo` detail.
 *
 * @param grpcCode - The gRPC status code
 * @param message - The error message
 * @param error - The SDK error instance (used to look up the reason code)
 * @returns gRPC Metadata with the encoded status details, or undefined if no reason mapping exists
 */
export function buildGrpcErrorMetadata(
  grpcCode: number,
  message: string,
  error: Error
): grpc.Metadata | undefined {
  const reason = A2A_ERROR_REASON[error.name];
  if (!reason) return undefined;

  const errorInfoBytes = encodeErrorInfo(reason, A2A_ERROR_DOMAIN);
  const anyBytes = encodeAny(ERROR_INFO_TYPE, errorInfoBytes);
  const statusBytes = encodeStatus(grpcCode, message, [anyBytes]);

  const metadata = new grpc.Metadata();
  metadata.set('grpc-status-details-bin', statusBytes);
  return metadata;
}

/**
 * Decodes a `google.rpc.Status` protobuf message from binary.
 * Used by the client to parse `grpc-status-details-bin` metadata.
 *
 * @returns Parsed status with code, message, and details (as Any messages with type_url and value).
 */
export function decodeStatus(buffer: Buffer): {
  code: number;
  message: string;
  details: Array<{ typeUrl: string; value: Buffer }>;
} {
  let offset = 0;
  let code = 0;
  let message = '';
  const details: Array<{ typeUrl: string; value: Buffer }> = [];

  while (offset < buffer.length) {
    const { value: tag, bytesRead: tagBytes } = readVarint(buffer, offset);
    offset += tagBytes;
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x7;

    if (wireType === WIRE_TYPE_VARINT) {
      const { value, bytesRead } = readVarint(buffer, offset);
      offset += bytesRead;
      if (fieldNumber === 1) code = value;
    } else if (wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const { value: len, bytesRead: lenBytes } = readVarint(buffer, offset);
      offset += lenBytes;
      const data = buffer.subarray(offset, offset + len);
      offset += len;

      if (fieldNumber === 2) {
        message = data.toString('utf-8');
      } else if (fieldNumber === 3) {
        // Parse google.protobuf.Any
        const any = decodeAny(data);
        details.push(any);
      }
    } else {
      break; // Unknown wire type
    }
  }

  return { code, message, details };
}

/**
 * Decodes a google.protobuf.Any message from binary.
 */
function decodeAny(buffer: Buffer): { typeUrl: string; value: Buffer } {
  let offset = 0;
  let typeUrl = '';
  let value = Buffer.alloc(0);

  while (offset < buffer.length) {
    const { value: tag, bytesRead: tagBytes } = readVarint(buffer, offset);
    offset += tagBytes;
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x7;

    if (wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const { value: len, bytesRead: lenBytes } = readVarint(buffer, offset);
      offset += lenBytes;
      const data = buffer.subarray(offset, offset + len);
      offset += len;

      if (fieldNumber === 1) typeUrl = data.toString('utf-8');
      else if (fieldNumber === 2) value = Buffer.from(data);
    } else {
      break;
    }
  }

  return { typeUrl, value };
}

/**
 * Decodes a google.rpc.ErrorInfo message from binary.
 */
export function decodeErrorInfo(buffer: Buffer): {
  reason: string;
  domain: string;
  metadata: Record<string, string>;
} {
  let offset = 0;
  let reason = '';
  let domain = '';
  const metadata: Record<string, string> = {};

  while (offset < buffer.length) {
    const { value: tag, bytesRead: tagBytes } = readVarint(buffer, offset);
    offset += tagBytes;
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x7;

    if (wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const { value: len, bytesRead: lenBytes } = readVarint(buffer, offset);
      offset += lenBytes;
      const data = buffer.subarray(offset, offset + len);
      offset += len;

      if (fieldNumber === 1) reason = data.toString('utf-8');
      else if (fieldNumber === 2) domain = data.toString('utf-8');
      else if (fieldNumber === 3) {
        // map<string, string> entry
        const entry = decodeMapEntry(data);
        if (entry) metadata[entry.key] = entry.value;
      }
    } else {
      break;
    }
  }

  return { reason, domain, metadata };
}

function decodeMapEntry(buffer: Buffer): { key: string; value: string } | undefined {
  let offset = 0;
  let key = '';
  let value = '';

  while (offset < buffer.length) {
    const { value: tag, bytesRead: tagBytes } = readVarint(buffer, offset);
    offset += tagBytes;
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x7;

    if (wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const { value: len, bytesRead: lenBytes } = readVarint(buffer, offset);
      offset += lenBytes;
      const data = buffer.subarray(offset, offset + len);
      offset += len;

      if (fieldNumber === 1) key = data.toString('utf-8');
      else if (fieldNumber === 2) value = data.toString('utf-8');
    } else {
      break;
    }
  }

  return key ? { key, value } : undefined;
}

function readVarint(buffer: Buffer, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset < buffer.length) {
    const byte = buffer[offset];
    value |= (byte & 0x7f) << shift;
    shift += 7;
    offset++;
    bytesRead++;
    if ((byte & 0x80) === 0) break;
  }

  return { value, bytesRead };
}
