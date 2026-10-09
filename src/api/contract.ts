// Vérification à la compilation (tsc) : les types générés depuis Rust (bindings.ts) doivent rester
// compatibles avec le contrat de l'UI (types.ts). Si un champ diverge, `pnpm build` échoue ici.
import type * as Rust from "./bindings";
import type * as Ui from "./types";

type Assignable<From, To> = [From] extends [To] ? true : false;
type Check<T extends true> = T;

// Ce que Rust renvoie doit être utilisable tel quel par l'UI…
export type Contract = [
  Check<Assignable<Rust.Sample, Ui.Sample>>,
  Check<Assignable<Rust.Tag, Ui.Tag>>,
  Check<Assignable<Rust.Collection_Serialize, Ui.Collection>>,
  Check<Assignable<Rust.VirtualFolder, Ui.VirtualFolder>>,
  Check<Assignable<Rust.CommitPlan, Ui.CommitPlan>>,
  Check<Assignable<Rust.CommitResult, Ui.CommitResult>>,
  Check<Assignable<Rust.FolderRow_Serialize, Ui.FolderRow>>,
  Check<Assignable<Rust.SampleRow, Ui.SampleRow>>,
  Check<Assignable<Rust.TreeRow_Serialize, Ui.TreeRow>>,
  Check<Assignable<Rust.TreePage_Serialize, Ui.TreePage>>,
  Check<Assignable<Rust.Library_Serialize, Ui.Library>>,
  Check<Assignable<Rust.Source, Ui.Source>>,
  // …et ce que l'UI envoie doit être accepté par Rust.
  Check<Assignable<Ui.TreeRequest, Rust.TreeRequest>>,
  Check<Assignable<Ui.CommitOptions, Rust.CommitOptions>>,
  // Les deux énumérations doivent rester identiques dans les deux sens.
  Check<Assignable<Rust.NodeKind, Ui.NodeKind>>,
  Check<Assignable<Ui.NodeKind, Rust.NodeKind>>,
  Check<Assignable<Ui.TreeRoot, Rust.TreeRoot>>,
  // L'UI exploite le discriminant `type` des lignes : il doit rester le même.
  Check<Assignable<Rust.FolderRow_Serialize["type"], "node">>,
  Check<Assignable<Rust.SampleRow["type"], "sample">>,
];
