import { HTTP_EXTENSION_HEADER } from "../../constants.js";

export function addExtensionHeader(req: RequestInit, extensions: string[]): RequestInit {
    if (!extensions?.length){
        return req;
    }

    const headers = new Headers(req.headers);
    headers.set(HTTP_EXTENSION_HEADER, extensions.join(','));
    return {
        ...req,
        headers,
    };
}