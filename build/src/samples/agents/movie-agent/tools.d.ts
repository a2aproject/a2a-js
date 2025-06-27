import { z } from "./genkit.js";
export declare const searchMovies: import("genkit").ToolAction<z.ZodObject<{
    query: z.ZodString;
}, "strip", z.ZodTypeAny, {
    query?: string;
}, {
    query?: string;
}>, z.ZodTypeAny>;
export declare const searchPeople: import("genkit").ToolAction<z.ZodObject<{
    query: z.ZodString;
}, "strip", z.ZodTypeAny, {
    query?: string;
}, {
    query?: string;
}>, z.ZodTypeAny>;
