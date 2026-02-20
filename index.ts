import { registerPluginHooksFromDir } from "openclaw/plugin-sdk";
import type { PluginApi } from "openclaw/plugin-sdk";

export default function register(api: PluginApi) {
  // Register hooks from the hooks directory
  registerPluginHooksFromDir(api, "./hooks");
  
  api.logger.info("Discord Audit Stream plugin loaded");
}
