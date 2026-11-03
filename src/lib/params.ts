/**
 * Los parámetros dinámicos de una ruta llegan codificados (p. ej. «J&J-08» llega como «J%26J-08»): hay que decodificarlos
 * antes de buscar el registro. Seguro de aplicar aunque ya vengan decodificados (los códigos no admiten «%»).
 */
export function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
