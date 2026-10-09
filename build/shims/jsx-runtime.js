// Automatic JSX runtime on top of Steam's React (createElement reads props.children).
const R = window.SP_REACT;
export const Fragment = R.Fragment;
export function jsx(type, props, key) {
  return R.createElement(type, key === undefined ? props : { ...props, key });
}
export const jsxs = jsx;
