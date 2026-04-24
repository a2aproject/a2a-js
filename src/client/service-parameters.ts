import { A2A_VERSION_HEADER, HTTP_EXTENSION_HEADER } from '../constants.js';
import { Extensions } from '../extensions.js';

export type ServiceParameters = Record<string, string>;

export type ServiceParametersUpdate = (parameters: ServiceParameters) => void;

export const ServiceParameters = {
  create(...updates: ServiceParametersUpdate[]): ServiceParameters {
    return ServiceParameters.createFrom(undefined, ...updates);
  },

  createFrom: (
    serviceParameters: ServiceParameters | undefined,
    ...updates: ServiceParametersUpdate[]
  ): ServiceParameters => {
    const result = serviceParameters ? { ...serviceParameters } : {};
    for (const update of updates) {
      update(result);
    }
    return result;
  },
};

export function withA2AExtensions(...extensions: Extensions): ServiceParametersUpdate {
  return (parameters: ServiceParameters) => {
    parameters[HTTP_EXTENSION_HEADER] = Extensions.toServiceParameter(extensions);
  };
}

/**
 * Creates a {@link ServiceParametersUpdate} that sets the A2A-Version header.
 * Per §3.6.1: "Clients MUST send the A2A-Version header with each request."
 */
export function withA2AVersion(version: string): ServiceParametersUpdate {
  return (parameters: ServiceParameters) => {
    parameters[A2A_VERSION_HEADER] = version;
  };
}
