import { openInPreferredEditor } from "./editorPreferences";
import { readNativeApi } from "./nativeApi";

export type InAppFileTargetOpener = (targetPath: string) => boolean | Promise<boolean>;

export async function openFileTarget(input: {
  targetPath: string;
  onOpenInApp?: InAppFileTargetOpener | undefined;
  missingApiWarning: string;
}): Promise<"in-app" | "editor" | null> {
  if (input.onOpenInApp) {
    const openedInApp = await input.onOpenInApp(input.targetPath);
    if (openedInApp) {
      return "in-app";
    }
  }

  const api = readNativeApi();
  if (!api) {
    console.warn(input.missingApiWarning);
    return null;
  }

  await openInPreferredEditor(api, input.targetPath);
  return "editor";
}
