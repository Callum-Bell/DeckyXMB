// Minimal typings for what Decky Loader provides at runtime (see build/shims).
declare const __PLUGIN_NAME__: string;

declare module "@decky/api" {
  export const routerHook: {
    addRoute(path: string, component: (...args: any[]) => any, props?: Record<string, unknown>): void;
    removeRoute(path: string): void;
    addPatch(path: string, patch: (props: any) => any): any;
    removePatch(path: string, patch: any): void;
  };
  export function call<A extends any[] = any[], R = any>(method: string, ...args: A): Promise<R>;
  export function definePlugin(fn: () => any): any;
  export const toaster: { toast(toast: { title: string; body: string; [prop: string]: any }): void };
  export enum FileSelectionType {
    FILE = 0,
    FOLDER = 1,
  }
  /** Decky's file browser; rejects if it's closed without choosing. */
  export function openFilePicker(
    select: FileSelectionType,
    startPath: string,
    includeFiles?: boolean,
    includeFolders?: boolean,
    filter?: RegExp | ((file: any) => boolean),
    extensions?: string[],
    showHiddenFiles?: boolean,
    allowAllFiles?: boolean,
    max?: number,
  ): Promise<{ path: string; realpath: string }>;
}

declare module "@decky/ui" {
  import { ComponentType, CSSProperties, ReactNode } from "react";
  export const Focusable: ComponentType<{ style?: CSSProperties; children?: ReactNode; [prop: string]: any }>;
  export const PanelSection: ComponentType<{ title?: string; children?: ReactNode }>;
  export const PanelSectionRow: ComponentType<{ children?: ReactNode }>;
  export const ToggleField: ComponentType<any>;
  export const ButtonItem: ComponentType<any>;
  export const DropdownItem: ComponentType<any>;
  export const SliderField: ComponentType<any>;
  export const staticClasses: Record<string, string>;
  export const footerClasses: Record<string, string>; // Steam's button-hint bar (BasicFooter, QuickAccessFooter...)
  export const GamepadButton: Record<string, number>;
  export const Navigation: { Navigate(route: string): void; NavigateBack(): void; [fn: string]: any };
  export function showContextMenu(menu: ReactNode, anchor?: any, options?: any): void;
  export function useParams<T = Record<string, string>>(): T;
  export const ConfirmModal: ComponentType<any>;
  export const TextField: ComponentType<any>;
  export function showModal(modal: ReactNode): { Close(): void };
}
