import type { StudioTextSettings } from "./types";

/** Extra properties the Studio stores on Fabric objects (saved in undo + autosave). */
interface StudioObjectProps {
  layerId?: string;
  studioText?: StudioTextSettings;
  studioName?: string;
}

declare module "fabric" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface FabricObject extends StudioObjectProps {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface FabricObjectProps extends StudioObjectProps {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface SerializedObjectProps extends StudioObjectProps {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface GroupProps extends StudioObjectProps {}
}
