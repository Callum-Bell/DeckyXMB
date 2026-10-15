// Sound effects bundled into the plugin as data URIs (esbuild's dataurl loader, build/build.mjs).
declare module "*.wav" {
  const url: string;
  export default url;
}
