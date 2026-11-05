import { createRequire } from "node:module";
import { resolve } from "node:path";

const apiRequire = createRequire(resolve(__dirname, "../../../apps/api/package.json"));
const { build } = createRequire(apiRequire.resolve("tsx"))("esbuild") as {
  build(options: object): Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};
let bundle: Promise<{ javascript: string; css: string }> | undefined;

export async function buildTryOnHarness() {
  bundle ??= build({
    entryPoints: [resolve(__dirname, "./realtime-tryon-harness.tsx")],
    nodePaths: [resolve(__dirname, "../../../apps/web/node_modules")],
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    write: false,
    outdir: "output/realtime-tryon/harness",
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
    plugins: [{
      name: "isolate-tryon-test-context",
      setup(builder: {
        onResolve(options: { filter: RegExp }, handler: () => { path: string; namespace: string }): void;
        onLoad(options: { filter: RegExp; namespace: string }, handler: (input: { path: string }) => { contents: string }): void;
      }) {
        builder.onResolve({ filter: /(?:^|\/)AuthProvider(?:\.tsx)?$/ }, () => ({ path: "auth", namespace: "tryon-test" }));
        builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "tryon-test" }));
        builder.onResolve({ filter: /^@decartai\/sdk$/ }, () => ({ path: "vendor", namespace: "tryon-test" }));
        builder.onLoad({ filter: /.*/, namespace: "tryon-test" }, ({ path }) => ({ contents: path === "auth"
          ? 'export const useAuth=()=>({session:{user:{id:"tryon-fixture-user"}}});'
          : path === "navigation"
            ? 'export const useRouter=()=>({push(){},replace(){},refresh(){},back(){}});export const usePathname=()=>"/__tryon-test/";export const useSearchParams=()=>new URLSearchParams();'
            : 'export const createDecartClient=()=>{throw new Error("Vendor SDK forbidden in simulated browser tests")};export const models={realtime(){throw new Error("Vendor model forbidden")}};export const noopLogger={};',
        }));
      },
    }],
  }).then((result) => {
    const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
    if (!javascript) throw new Error("Try-on fixture did not produce a JavaScript bundle");
    return { javascript, css: result.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "" };
  });
  return bundle;
}
