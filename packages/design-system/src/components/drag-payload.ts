// MIME type customizado do payload de arraste de uma candidatura no funil
// (CandidateCard -> KanbanColumn). Compartilhado pelos dois componentes em
// vez de duplicado como literal em cada um.
//
// Por que existe -- achados F2/F3 da revisão final do R2a:
//
// 1. Firefox aborta um drag cujo data store continua vazio quando o
//    dragstart termina (Chrome/Safari toleram). CandidateCard.onDragStart
//    precisa chamar dataTransfer.setData com pelo menos um tipo -- este,
//    mais 'text/plain' para o Firefox aceitar o drag mesmo sem um
//    consumidor deste tipo customizado.
// 2. KanbanColumn só deve preventDefault/destacar como alvo de drop quando
//    o drag em curso carrega ESTE tipo -- um arquivo ou texto de outra
//    janela tem outros tipos (ex.: 'Files'), e não deve virar alvo válido
//    só porque a coluna sempre chamava preventDefault incondicionalmente.
export const TIPO_MIME_CANDIDATURA = 'application/x-tinocerto-candidatura';
