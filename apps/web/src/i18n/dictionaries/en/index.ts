import type { AppDictionary } from "../types";
import { common } from "./common";
import { shell } from "./shell";
import { discover } from "./discover";
import { feed } from "./feed";
import { detail } from "./detail";
import { dashboard } from "./dashboard";
import { workspace } from "./workspace";
import { ops } from "./ops";
import { auth } from "./auth";
import { support } from "./support";
import { taxonomy } from "./taxonomy";
import { status } from "./status";
import { meta } from "./meta";

export const en = {
  common,
  shell,
  discover,
  feed,
  detail,
  dashboard,
  workspace,
  ops,
  auth,
  support,
  taxonomy,
  status,
  meta,
} satisfies AppDictionary;
