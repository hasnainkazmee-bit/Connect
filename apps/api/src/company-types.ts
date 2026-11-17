import { z } from "zod";
import { companyTypeValues } from "./shared/company-types.js";

export const companyTypeSchema = z.enum(companyTypeValues, {
  error: "Choose a business type from the list.",
});

// Existing imported classifications and incomplete legacy profiles can be kept
// during unrelated edits. Every changed classification must come from the list.
export const companyTypeUpdateInput = z.string().trim().max(80);
export function validateCompanyTypeUpdate(value: string, current: string) {
  if (value !== current) companyTypeSchema.parse(value);
}
