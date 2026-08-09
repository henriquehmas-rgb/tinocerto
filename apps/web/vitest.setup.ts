import '@testing-library/jest-dom';

// Radix UI (DropdownMenu, Select, etc.) depende de APIs de ponteiro que o jsdom não
// implementa (PointerEvent, hasPointerCapture, scrollIntoView) e de uma
// sequência real de pointerdown -> click, que `fireEvent.click` do Testing
// Library não simula (ele dispara apenas o evento 'click'). Os polyfills
// abaixo tornam os componentes baseados em Radix testáveis em jsdom com
// `fireEvent.click`.

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerType: string;
    constructor(type: string, props: PointerEventInit = {}) {
      super(type, props);
      this.pointerType = props.pointerType ?? 'mouse';
    }
  }
  // @ts-expect-error jsdom não expõe PointerEvent nativamente
  window.PointerEvent = PointerEventPolyfill;
}

// Simula, na fase de captura, o pointerdown que precede um click real do
// usuário — necessário porque gatilhos do Radix (ex.: DropdownMenu.Trigger,
// Select.Trigger) abrem no pointerdown, evento que `fireEvent.click` isolado
// não dispara.
document.addEventListener(
  'click',
  (event) => {
    const target = event.target as Element | null;
    if (!target || typeof target.dispatchEvent !== 'function') return;
    // Não sintetiza pointerdown para cliques em itens já dentro de um popup
    // Radix aberto (menuitem, option, etc.) -- o Select do Radix processa a
    // seleção do item no próprio ciclo pointerdown/pointerup nativo do
    // 'click', e um pointerdown sintético extra ali interfere com essa
    // lógica interna (fecha o listbox antes da seleção ser registrada).
    // É necessário apenas para ABRIR o trigger (DropdownMenu/Select), que
    // dispara no pointerdown e não reage ao 'click' isolado do jsdom.
    if (target.closest('[role="menuitem"], [role="option"]')) return;
    target.dispatchEvent(
      new window.PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
      }),
    );
  },
  true,
);
