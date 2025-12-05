import { HTTP_EXTENSION_HEADER } from '../constants.js';

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

export function withA2AExtensions(...extensions: string[]): ServiceParametersUpdate {
  return (parameters: ServiceParameters) => {
    parameters[HTTP_EXTENSION_HEADER] = extensions.join(',');
  };
}
