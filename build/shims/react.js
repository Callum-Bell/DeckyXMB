// Steam's own React instance (Decky externalizes react the same way).
const R = window.SP_REACT;
export default R;
export const { createElement, Fragment, useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, memo, Component } = R;
