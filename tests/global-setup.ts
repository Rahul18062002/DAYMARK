import { config } from "dotenv";
import { resetTestDatabase } from "./db-reset";

export default function setup() {
  config({ path: ".env.test", override: true });
  resetTestDatabase("inherit");
}
