import { For, Show, type JSX } from "solid-js";
import type { FolderNode, Scope } from "../api";
import { app } from "../state/app";
import { Chevron, Icon } from "./Icon";
import { SidebarItem } from "./SidebarItem";

const same = (a: Scope, b: Scope) => JSON.stringify(a) === JSON.stringify(b);

function Section(props: { id: string; title: string; action?: JSX.Element; children: JSX.Element }) {
  const open = () => app.openSections()[props.id];
  return (
    <section class="cr-section" data-open={open() || undefined}>
      <button class="cr-section__header" aria-expanded={open()} onClick={() => app.toggleSection(props.id)}>
        <Chevron open={open()} />
        <span class="cr-section__title">{props.title}</span>
        {props.action}
      </button>
      <Show when={open()}>
        <div class="cr-section__body" role="group">
          {props.children}
        </div>
      </Show>
    </section>
  );
}

function Folder(props: { node: FolderNode; depth: number }) {
  const scope = (): Scope => ({ type: "folder", id: props.node.id });
  const open = () => app.expanded().includes(props.node.id);
  return (
    <>
      <SidebarItem
        label={props.node.name}
        count={props.node.count}
        depth={props.depth}
        expandable={props.node.children.length > 0}
        open={open()}
        offline={props.node.offline}
        selected={same(app.scope(), scope())}
        onToggle={() => app.toggleFolder(props.node.id)}
        onClick={() => app.goTo(scope())}
        onDblClick={() => app.toggleFolder(props.node.id)}
      />
      <Show when={open()}>
        <For each={props.node.children}>{(c) => <Folder node={c} depth={props.depth + 1} />}</For>
      </Show>
    </>
  );
}

export function Sidebar() {
  const lib = () => app.library();
  const item = (label: string, scope: Scope, count?: number) => (
    <SidebarItem label={label} count={count} selected={same(app.scope(), scope)} onClick={() => app.goTo(scope)} />
  );
  return (
    <nav class="cr-sidebar" aria-label="Navigation" role="tree">
      <Show when={lib()}>
        {(l) => (
          <>
            <Section id="library" title="Bibliothèque">
              {item("Tous les samples", { type: "all" }, l().total)}
              {item("Favoris", { type: "fav" }, l().favCount)}
              {item("Récents", { type: "recent" }, l().recentCount)}
              {item("Non tagués", { type: "untagged" }, l().untaggedCount)}
            </Section>
            <Section
              id="collections"
              title="Collections"
              action={
                <span class="cr-section__action" title="Nouvelle collection" onClick={(e) => e.stopPropagation()}>
                  <Icon name="plus" />
                </span>
              }
            >
              <For each={l().collections}>
                {(c) => (
                  <SidebarItem
                    label={c.name}
                    count={c.count}
                    mark={c.kind}
                    selected={same(app.scope(), { type: "collection", id: c.id })}
                    dropTarget={app.dropTarget() === c.id}
                    renaming={app.renamingId() === c.id}
                    onClick={() => app.goTo({ type: "collection", id: c.id })}
                    onDblClick={() => app.setRenamingId(c.id)}
                    onRename={(name) => app.renameCollection(c.id, name)}
                    onDragOver={(e) => {
                      if (c.kind !== "manual") return;
                      e.preventDefault();
                      app.setDropTarget(c.id);
                    }}
                    onDragLeave={() => app.setDropTarget(null)}
                    onDrop={(e) => {
                      e.preventDefault();
                      app.setDropTarget(null);
                    }}
                  />
                )}
              </For>
            </Section>
            <Section id="sources" title="Sources">
              <For each={l().sources}>{(n) => <Folder node={n} depth={0} />}</For>
            </Section>
          </>
        )}
      </Show>
    </nav>
  );
}
