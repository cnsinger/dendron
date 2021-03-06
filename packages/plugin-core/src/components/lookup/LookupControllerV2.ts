import { DNodePropsQuickInputV2, NotePropsV2 } from "@dendronhq/common-all";
import GithubSlugger from "github-slugger";
import _ from "lodash";
import path from "path";
import * as vscode from "vscode";
import { QuickInputButton } from "vscode";
import {
  LookupCommandOpts,
  LookupNoteExistBehavior,
} from "../../commands/LookupCommand";
import { CONFIG } from "../../constants";
import { Logger } from "../../logger";
import { EngineOpts } from "../../types";
import { DendronClientUtilsV2, VSCodeUtils } from "../../utils";
import { DendronWorkspace } from "../../workspace";
import {
  ButtonCategory,
  ButtonType,
  createAllButtons,
  DendronBtn,
  getButtonCategory,
  IDendronQuickInputButton,
} from "./buttons";
import { LookupProviderV2 } from "./LookupProviderV2";
import { DendronQuickPickerV2, LookupControllerState } from "./types";

export class LookupControllerV2 {
  public quickPick?: DendronQuickPickerV2;
  public state: LookupControllerState;
  protected opts: EngineOpts;
  public provider?: LookupProviderV2;

  constructor(
    opts: EngineOpts,
    lookupOpts?: Omit<LookupCommandOpts, "flavor">
  ) {
    // selection behaior
    let lookupSelectionType =
      lookupOpts?.selectionType ||
      (DendronWorkspace.configuration().get<string>(
        CONFIG.DEFAULT_LOOKUP_CREATE_BEHAVIOR.key
      ) as ButtonType);
    let noteSelectioType = lookupOpts?.noteType;
    let initialTypes = [lookupSelectionType];
    if (noteSelectioType) {
      initialTypes.push(noteSelectioType);
    }
    if (lookupOpts?.effectType) {
      initialTypes.push(lookupOpts.effectType);
    }

    // initialize rest
    this.state = {
      buttons: opts.flavor === "note" ? createAllButtons(initialTypes) : [],
      buttonsPrev: [],
    };
    this.opts = opts;
  }

  onTriggerButton = async (btn: QuickInputButton) => {
    const quickPick = this.quickPick;
    const provider = this.provider;
    if (!quickPick || !provider) {
      return;
    }
    const resp = await VSCodeUtils.extractRangeFromActiveEditor();
    const { document, range } = _.defaults(resp, {
      document: null,
      range: null,
    });
    const btnType = (btn as IDendronQuickInputButton).type;

    const btnTriggered = _.find(this.state.buttons, {
      type: btnType,
    }) as DendronBtn;
    if (!btnTriggered) {
      throw Error("bad button type");
    }
    btnTriggered.pressed = !btnTriggered.pressed;
    const btnCategory = getButtonCategory(btnTriggered);
    // toggle other buttons in same category off
    if (!_.includes(["effect"] as ButtonCategory[], btnCategory)) {
      _.filter(this.state.buttons, (ent) => ent.type !== btnTriggered.type).map(
        (ent) => {
          if (getButtonCategory(ent) === btnCategory) {
            ent.pressed = false;
          }
        }
      );
    }

    this.refreshButtons(quickPick, this.state.buttons);
    await this.updatePickerBehavior({
      quickPick,
      document,
      range,
      provider,
      changed: btnTriggered,
    });
  };

  refreshButtons(quickpick: DendronQuickPickerV2, buttons: DendronBtn[]) {
    this.state.buttonsPrev = quickpick.buttons.map((b: DendronBtn) =>
      b.clone()
    );
    quickpick.buttons = buttons;
  }

  async show(opts?: {
    value?: string;
    ignoreFocusOut?: boolean;
    document?: vscode.TextDocument;
    range?: vscode.Range;
    noConfirm?: boolean;
    noteExistBehavior?: LookupNoteExistBehavior;
  }) {
    const ctx = "LookupControllerV2:show";
    const cleanOpts = _.defaults(opts, {
      ignoreFocusOut: true,
    });
    const { document, range } = cleanOpts;
    Logger.info({ ctx, msg: "enter", cleanOpts });
    // create quick pick
    const quickPick = vscode.window.createQuickPick<
      DNodePropsQuickInputV2
    >() as DendronQuickPickerV2;
    let title = [`Lookup (${this.opts.flavor})`];
    title.push(`- version: ${DendronWorkspace.version()}`);
    quickPick.title = title.join(" ");
    quickPick.placeholder = "eg. hello.world";
    quickPick.ignoreFocusOut = cleanOpts.ignoreFocusOut;
    quickPick.justActivated = true;
    quickPick.canSelectMany = false;
    const provider = new LookupProviderV2(this.opts);
    this.provider = provider;

    this.refreshButtons(quickPick, this.state.buttons);
    await this.updatePickerBehavior({
      quickPick,
      document,
      range,
      quickPickValue: cleanOpts.value,
      provider,
    });
    quickPick.onDidTriggerButton(this.onTriggerButton);

    // cleanup quickpick
    quickPick.onDidHide(() => {
      quickPick.dispose();
      this.quickPick = undefined;
    });

    provider.provide(quickPick);
    if (opts?.noConfirm) {
      // would be empty if not set
      quickPick.selectedItems = quickPick.items;
      await provider.onDidAccept(quickPick, { flavor: this.opts.flavor });
    } else {
      quickPick.show();
    }
    this.quickPick = quickPick;
    return quickPick;
  }

  async updateBehaviorByNoteType({
    noteResp,
    quickPick,
    provider,
    quickPickValue,
  }: {
    noteResp?: DendronBtn;
    quickPick: DendronQuickPickerV2;
    provider: LookupProviderV2;
    quickPickValue?: string;
  }) {
    const { selection, text } = VSCodeUtils.getSelection();
    const buttons = this.state.buttons;
    let suffix: string | undefined;

    if (
      !_.isEmpty(selection) &&
      !_.isUndefined(text) &&
      !_.isEmpty(text) &&
      _.find(_.filter(buttons, { pressed: true }), {
        type: "selection2link",
      }) &&
      DendronWorkspace.configuration().get<string>(
        CONFIG.LINK_SELECT_AUTO_TITLE_BEHAVIOR.key
      ) === "slug"
    ) {
      const slugger = new GithubSlugger();
      suffix = slugger.slug(text);
    }
    let onUpdateReason: any = "updatePickerBehavior:normal";
    let onUpdateValue: string;

    switch (noteResp?.type) {
      case "journal": {
        onUpdateValue = DendronClientUtilsV2.genNoteName("JOURNAL");
        onUpdateReason = "updatePickerBehavior:journal";
        break;
      }
      case "scratch": {
        onUpdateValue = DendronClientUtilsV2.genNoteName("SCRATCH");
        onUpdateReason = "updatePickerBehavior:scratch";
        break;
      }
      default:
        if (quickPickValue) {
          onUpdateValue = quickPickValue;
        } else {
          let editorPath = vscode.window.activeTextEditor?.document.uri.fsPath;
          if (editorPath && this.opts.flavor !== "schema") {
            onUpdateValue = path.basename(editorPath, ".md");
          } else {
            onUpdateValue = "";
          }
        }
        onUpdateReason = "updatePickerBehavior:normal";
    }
    if (!_.isUndefined(suffix)) {
      onUpdateValue = [onUpdateValue, suffix].join(".");
    }
    quickPick.value = onUpdateValue;
    await provider.onUpdatePickerItem(quickPick, provider.opts, onUpdateReason);
  }

  async updateBehaviorByEffect({
    quickPick,
  }: {
    quickPick: DendronQuickPickerV2;
  }) {
    const effectResp = _.filter(
      quickPick.buttons,
      (ent) => getButtonCategory(ent) === "effect"
    );
    await Promise.all(
      effectResp.map(async (effect) => {
        return effect.handle({ quickPick });
      })
    );
  }

  async updatePickerBehavior(opts: {
    quickPick: DendronQuickPickerV2;
    document?: vscode.TextDocument;
    range?: vscode.Range;
    quickPickValue?: string;
    provider: LookupProviderV2;
    changed?: DendronBtn;
  }) {
    const ctx = "updatePickerBehavior";
    const {
      document,
      range,
      quickPick,
      quickPickValue,
      provider,
      changed,
    } = opts;
    const buttons = this.state.buttons;
    // get all pressed buttons
    const resp = _.filter(buttons, { pressed: true });
    Logger.info({ ctx, activeButtons: resp });
    const noteResp = _.find(resp, (ent) => getButtonCategory(ent) === "note");
    // collect info
    const selectionResp = _.find(
      resp,
      (ent) => getButtonCategory(ent) === "selection"
    );
    const filterResp = _.find(
      resp,
      (ent) => getButtonCategory(ent) === "filter"
    );
    const selection2LinkChanged = changed?.type === "selection2link";

    // handle effect resp
    await this.updateBehaviorByEffect({ quickPick });

    // handle note resp, requires updating picker value
    if (
      !changed ||
      (changed && getButtonCategory(changed) === "note") ||
      selection2LinkChanged
    ) {
      this.updateBehaviorByNoteType({
        noteResp,
        quickPick,
        provider,
        quickPickValue,
      });
    }

    // handle selection resp
    quickPick.onCreate = async (note: NotePropsV2) => {
      switch (selectionResp?.type) {
        case "selectionExtract": {
          if (!_.isUndefined(document)) {
            const body = "\n" + document.getText(range).trim();
            note.body = body;
            await VSCodeUtils.deleteRange(document, range as vscode.Range);
          }
          break;
        }
        case "selection2link": {
          if (!_.isUndefined(document)) {
            const editor = VSCodeUtils.getActiveTextEditor();
            const { selection, text } = VSCodeUtils.getSelection();
            await editor?.edit((builder) => {
              const link = note.fname;
              if (!_.isUndefined(selection) && !selection.isEmpty) {
                builder.replace(selection, `[[${text}|${link}]]`);
              }
            });
          }
          break;
        }
        default: {
          quickPick.onCreate = async () => {};
        }
      }
    };

    // handle filter resp
    const before = quickPick.showDirectChildrenOnly;
    if (filterResp) {
      quickPick.showDirectChildrenOnly = true;
    } else {
      quickPick.showDirectChildrenOnly = false;
    }
    if (quickPick.showDirectChildrenOnly !== before) {
      Logger.info({ ctx, msg: "toggle showDirectChildOnly behavior" });
      await provider.onUpdatePickerItem(quickPick, provider.opts, "manual");
    }
  }
}
