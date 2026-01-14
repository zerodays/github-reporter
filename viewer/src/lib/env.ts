import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

declare global {
  var __viewerEnvErrorLogged: boolean | undefined;
}

export const env = createEnv({
  server: {
    R2_BUCKET: z.string().min(1),
    R2_REGION: z.string().min(1).default("auto"),
    R2_ENDPOINT: z.string().min(1),
    R2_FORCE_PATH_STYLE: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
  },
  client: {
    NEXT_PUBLIC_DEFAULT_OWNER: z.string().optional(),
    NEXT_PUBLIC_DEFAULT_OWNER_TYPE: z.enum(["user", "org"]).optional(),
    NEXT_PUBLIC_REPORT_PREFIX: z.string().optional(),
  },
  runtimeEnv: {
    R2_BUCKET: process.env.R2_BUCKET,
    R2_REGION: process.env.R2_REGION,
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    R2_FORCE_PATH_STYLE: process.env.R2_FORCE_PATH_STYLE,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    NEXT_PUBLIC_DEFAULT_OWNER: process.env.NEXT_PUBLIC_DEFAULT_OWNER,
    NEXT_PUBLIC_DEFAULT_OWNER_TYPE: process.env.NEXT_PUBLIC_DEFAULT_OWNER_TYPE,
    NEXT_PUBLIC_REPORT_PREFIX: process.env.NEXT_PUBLIC_REPORT_PREFIX,
  },
  onValidationError: (error) => {
    if (!globalThis.__viewerEnvErrorLogged) {
      globalThis.__viewerEnvErrorLogged = true;
      const message = `❌ Invalid environment variables: ${JSON.stringify(
        error.flatten().fieldErrors,
        null,
        2
      )}`;
      console.error(message);
    }
    process.exit(1);
  },
});
