import { tmpDir } from "@dendronhq/common-server";
import {
  EngineTestUtilsV2,
  FileTestUtils,
  NodeTestUtilsV2,
} from "@dendronhq/common-test-utils";
import { DConfig, Git, WorkspaceService } from "@dendronhq/engine-server";
import path from "path";
import { PublishNotesCommand } from "../publishNotes";

describe("publishNotes", async () => {
  let wsRoot: string;
  let vault: string;
  // @ts-ignore
  let siteRootDir: string;

  beforeEach(async () => {
    wsRoot = tmpDir().name;
    siteRootDir = tmpDir().name;
    const { vaults } = await EngineTestUtilsV2.setupWS({
      initDirCb: async (root) => {
        await new WorkspaceService().createVault({ vault: { fsPath: root } });
        NodeTestUtilsV2.createNotes({
          vaultPath: root,
          noteProps: [
            { id: "id-foo", fname: "foo", stub: true },
            { id: "id-bar", fname: "bar" },
          ],
        });
      },
    });
    vault = vaults[0];
    await DConfig.getOrCreate(wsRoot);
  });

  test("publish, no push", async () => {
    const { buildNotesRoot } = await PublishNotesCommand.run({
      wsRoot,
      vault,
      noPush: true,
    });
    const notesDir = path.join(buildNotesRoot, "notes");
    FileTestUtils.cmpFiles(notesDir, ["id-bar.md", "id-foo.md", "root.md"]);
  });

  test("publish but no git", async () => {
    try {
      await PublishNotesCommand.run({
        wsRoot,
        vault,
      });
    } catch (err) {
      expect(err.message).toEqual("no repo found");
    }
  });

  test("publish, ok", async () => {
    await Git.createRepo(wsRoot, { initCommit: true });
    const { buildNotesRoot } = await PublishNotesCommand.run({
      wsRoot,
      vault,
      noPush: true,
    });
    const notesDir = path.join(buildNotesRoot, "notes");
    FileTestUtils.cmpFiles(notesDir, ["id-bar.md", "id-foo.md", "root.md"]);
  });
});
