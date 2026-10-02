/** Erro com mensagem pronta para mostrar na tela do usuario. */
export class BadRequest extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message)
    this.name = 'BadRequest'
    this.status = status
    this.extra = extra
  }
}
