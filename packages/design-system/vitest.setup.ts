import '@testing-library/jest-dom';

// Radix UI usa Pointer Events e scrollIntoView, que o jsdom não implementa.
// Polyfill mínimo necessário para testar componentes baseados em Radix.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
