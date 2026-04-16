import { z } from "zod";

export const uuidString = z.string().uuid();
