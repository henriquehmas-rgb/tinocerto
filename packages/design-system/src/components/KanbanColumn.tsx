import React, { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { TIPO_MIME_CANDIDATURA } from "./drag-payload";

export interface KanbanColumnProps<T> {
  chave: string;
  titulo: string;
  itens: T[];
  total: number;
  conversao?: number | null;
  colunasDestino: { chave: string; titulo: string }[];
  renderItem: (item: T, acao: React.ReactNode) => React.ReactNode;
  labelMover: (item: T) => string;
  onMoverItem: (item: T, novaColuna: string) => void;
  /** `payload` é o que veio no dataTransfer do card solto -- ver TIPO_MIME_CANDIDATURA. */
  onSoltarItem?: (chaveDestino: string, payload: string) => void;
  mensagemVazia?: string;
}

/**
 * O evento de drag carrega o tipo customizado que identifica um card
 * arrastável do funil (ver TIPO_MIME_CANDIDATURA)? `types` é a única
 * informação do dataTransfer que o navegador expõe durante
 * dragenter/dragover (o "modo protegido" da API nativa de drag-and-drop
 * bloqueia leitura de valor -- getData() -- até o drop; só `types`, a
 * lista de nomes de formato, fica visível antes disso). Um arquivo ou
 * texto arrastado de outra janela tem outros tipos (ex.: 'Files') e não
 * deve virar alvo válido só porque a coluna sempre chamava preventDefault
 * incondicionalmente (achado F3 da revisão final).
 */
function carregaTipoCandidatura(evento: React.DragEvent): boolean {
  return Boolean(evento.dataTransfer?.types?.includes(TIPO_MIME_CANDIDATURA));
}

export function KanbanColumn<T extends { id: string | number }>({
  chave,
  titulo,
  itens,
  total,
  conversao,
  colunasDestino,
  renderItem,
  labelMover,
  onMoverItem,
  onSoltarItem,
  mensagemVazia = "Nenhum item nesta etapa",
}: KanbanColumnProps<T>) {
  // Estado local do alvo de drop: ativo enquanto um card é arrastado sobre
  // esta coluna. Só existe visualmente aqui — o componente continua sem
  // saber nada sobre candidatos.
  const [sobreposto, setSobreposto] = useState(false);

  // Verdadeiro enquanto o drag em curso começou por um card DESTA coluna.
  // dragstart borbulha do card (filho) até aqui (a coluna nunca desenha o
  // draggable -- quem desenha é o consumidor via renderItem), então, ao
  // contrário de ler o payload durante dragenter/dragover (bloqueado pelo
  // "modo protegido", ver carregaTipoCandidatura acima), isto funciona de
  // verdade no navegador: dragstart roda em modo leitura/escrita, e só a
  // coluna de origem do card recebe esse borbulhamento -- nenhuma coluna
  // vizinha é notificada. Usado só para suprimir o destaque visual
  // (achado F7): soltar na própria coluna já é um no-op inofensivo do
  // lado dos dados (ver resolverDestino na página), então um falso
  // positivo aqui na pior hipótese pisca um destaque, nunca move nada.
  const [origemDoArraste, setOrigemDoArraste] = useState(false);

  return (
    <div
      data-testid={`coluna-${chave}`}
      data-sobreposto={sobreposto ? "true" : undefined}
      className="flex min-w-[240px] flex-col gap-2"
      style={sobreposto ? { background: "var(--pr-selected)" } : undefined}
      onDragStart={(evento) => {
        if (carregaTipoCandidatura(evento)) setOrigemDoArraste(true);
      }}
      onDragEnd={() => setOrigemDoArraste(false)}
      onDragEnter={(evento) => {
        // Sem preventDefault o navegador não considera o alvo válido e
        // nunca dispara onDrop.
        if (!onSoltarItem || !carregaTipoCandidatura(evento)) return;
        evento.preventDefault();
        if (!origemDoArraste) setSobreposto(true);
      }}
      onDragOver={(evento) => {
        if (!onSoltarItem || !carregaTipoCandidatura(evento)) return;
        evento.preventDefault();
        if (!origemDoArraste) setSobreposto(true);
      }}
      onDragLeave={(evento) => {
        if (!onSoltarItem) return;
        // Armadilha clássica do drag-and-drop nativo: dragleave dispara ao
        // cruzar para um elemento filho (ex.: um card), não só ao sair da
        // coluna de fato. Só desativamos o destaque quando o ponteiro vai
        // para fora da coluna inteira.
        const destinoRelacionado = evento.relatedTarget as Node | null;
        if (!destinoRelacionado || !evento.currentTarget.contains(destinoRelacionado)) {
          setSobreposto(false);
        }
      }}
      onDrop={(evento) => {
        setSobreposto(false);
        setOrigemDoArraste(false);
        const payload = evento.dataTransfer?.getData(TIPO_MIME_CANDIDATURA) ?? "";
        onSoltarItem?.(chave, payload);
      }}
    >
      <div className="flex items-center gap-2 border-b-2 border-border pb-1">
        <h3 className="font-ui text-[12px] font-semibold text-text">{titulo}</h3>
        <span
          data-testid="contador"
          className="rounded-full px-1.5 font-num text-[11px] tabular-nums text-text-secondary"
          style={{ background: "var(--pr-surface-sunken)" }}
        >
          {total}
        </span>
        {conversao !== null && conversao !== undefined && (
          <span data-testid="conversao" className="ml-auto font-num text-[11px] tabular-nums text-text-secondary">
            {conversao}%
          </span>
        )}
      </div>

      {itens.length === 0 && <p className="font-ui text-sm text-text-secondary">{mensagemVazia}</p>}

      {itens.map((item) => {
        const acao = (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="pr-focusable rounded-control border border-border px-2 py-1 text-xs"
                aria-label={labelMover(item)}
              >
                Mover
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="rounded-panel border border-border bg-surface shadow-lg">
                {colunasDestino.map((coluna) => (
                  <DropdownMenu.Item
                    key={coluna.chave}
                    onSelect={() => onMoverItem(item, coluna.chave)}
                    className="cursor-pointer px-3 py-2 text-sm text-text outline-none data-[highlighted]:bg-accent data-[highlighted]:text-on-accent"
                  >
                    {coluna.titulo}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        );
        return <React.Fragment key={item.id}>{renderItem(item, acao)}</React.Fragment>;
      })}
    </div>
  );
}
