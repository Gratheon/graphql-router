import config from "./config.default";

function loadConfig<T>(filePath: string): T | undefined {
  try {
    return require(filePath).default;
  } catch (error) {
    console.error(`Failed to load config '${filePath}':`, error);
    return undefined;
  }
}

const env = process.env.ENV_ID || "default";
const customConfig = loadConfig<typeof config>(`./config.${env}`);

const currentConfig = { ...config, ...customConfig };

export function get<T extends keyof typeof config>(
  key: T
): typeof config[T] {
  return currentConfig[key];
}

export default currentConfig;
