import { chromium, request } from "@playwright/test";
// Thin handle so helpers can create standalone API request contexts.
export const playwright = { chromium, request };
