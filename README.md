# UMP Vendas — sistema de venda de pasteis

Sistema de caixa e controle de estoque para venda de pasteis em evento da igreja.
Roda **na rede local**: um computador faz o papel de servidor e os outros acessam
pelo navegador. Nao precisa de internet.

---

## Em 2 passos (no computador servidor)

1. Instale o [Node.js 22 ou mais novo](https://nodejs.org) (versao LTS).
2. De **duplo clique em `INICIAR.bat`**.

Pronto. Na primeira vez ele instala os componentes sozinho (leva alguns minutos);
nas proximas abre na hora. **Deixe a janela preta aberta o evento inteiro** — fechar
ela desliga o sistema.

| Arquivo        | Para que serve                                   |
| -------------- | ------------------------------------------------ |
| `INICIAR.bat`  | Liga o sistema                                    |
| `CODIGOS.bat`  | Mostra os codigos de acesso dos tres perfis       |
| `BACKUP.bat`   | Salva uma copia do banco em `backups/`            |

> Prefere terminal? `npm run setup` uma vez e `npm start` nas demais.

A janela mostra os enderecos e os **codigos de acesso**:

```
========================================================
  VENDA DE PASTEIS
========================================================
  Neste computador:  http://localhost:3000
  Nos outros PCs:    http://192.168.0.15:3000
========================================================
  CODIGOS DE ACESSO:
    admin    UMPADM
    caixa    UMPCAI
    cozinha  UMPCOZ
```

No outro computador, abra o Chrome e digite o endereco `http://192.168.0.15:3000`
(use o IP que aparecer no **seu** terminal). Deixe a aba aberta o dia todo.

### Codigos de acesso

| Perfil  | Codigo   |
| ------- | -------- |
| admin   | `UMPADM` |
| caixa   | `UMPCAI` |
| cozinha | `UMPCOZ` |

Pode digitar em minusculo — o sistema nao diferencia. Eles ficam tambem em
`server/data/CODIGOS.txt` e no `CODIGOS.bat`.

Sao codigos fixos e faceis de decorar, entao qualquer um que os conheca entra. Se
um deles vazar no meio do evento, troque na aba **Admin** e clique em **Revogar
acessos** — todo mundo tem que entrar de novo. Para voltar aos padroes depois:

```bash
npm run codigos -- --padrao
```

### Se o outro computador nao abrir o sistema

Na ordem, do mais comum para o mais raro:

1. **Confira o endereco na hora.** O IP muda toda vez que o servidor troca de rede
   (Wi-Fi da igreja, cabo, roteador do celular). O numero certo e sempre o que esta
   escrito na janela preta AGORA, em *"Nos outros PCs"*. Um endereco anotado ontem
   provavelmente ja morreu.
2. **Os dois na mesma rede.** Mesmo Wi-Fi (mesmo nome de rede) ou mesmo cabo. Wi-Fi
   da igreja num PC e roteador do celular no outro nao se enxergam.
3. **Digite o endereco completo** com `http://` e a porta: `http://192.168.0.15:3000`.
   So o IP, sem `:3000`, nao abre.
4. **Firewall do Windows.** Na primeira vez que o Node abre uma porta, o Windows
   pergunta se libera — marque **Redes privadas** e permita. Se ninguem viu o aviso,
   o acesso fica bloqueado calado. Para conferir, no PC servidor, no PowerShell:
   `Get-NetFirewallRule -Direction Inbound -Enabled True` filtrando por `nodejs`;
   tem que existir ao menos uma regra `Allow`.
5. **Rede com isolamento de clientes.** Wi-Fi de visitante e alguns roteadores de
   celular bloqueiam um aparelho de falar com o outro, mesmo os dois conectados. Nao
   tem ajuste no sistema — use outra rede ou um roteador proprio.

Teste rapido: no PC servidor, abra o endereco de *"Nos outros PCs"* no navegador
dele mesmo. Se abrir ali e nao no outro PC, o problema e rede (itens 2 a 5), nao o
sistema.

### Se aparecer "a porta 3000 ja esta sendo usada"

Outro programa pegou a porta. O `INICIAR.bat` mostra qual e. Feche esse programa,
ou abra o Prompt de Comando nesta pasta e rode `INICIAR.bat 3001` — ai o endereco
dos outros computadores termina em `:3001`.

Atencao neste PC: o **docker-compose do projeto WikiLaw usa a porta 3000**. Se ele
estiver no ar, um dos dois tem que ceder.

---

## Os tres perfis

| Perfil      | Quem usa              | O que faz                                                                  |
| ----------- | --------------------- | -------------------------------------------------------------------------- |
| **cozinha** | computador da cozinha | Cadastra sabores, lanca producao e da baixa nas retiradas                  |
| **caixa**   | computador da venda   | Define o valor do pastel, lanca os pedidos e acompanha os KPIs             |
| **admin**   | responsavel           | Tudo acima, mais custos, codigos, exportacao e excluir/cancelar pedidos     |

Cada perfil entra com o seu proprio codigo na tela inicial e ja cai na tela que
vai usar o dia todo.

Os **sabores** (cadastrar, ligar/desligar) ficam na aba **Cozinha** — e a cozinha que
sabe o que tem e o que acabou. O **valor do pastel** fica na aba **Caixa**, porque e
o caixa que fala com o cliente. O **Admin** cuida de pedidos, custos, codigos e
relatorio.

---

## Como funciona na pratica

**Antes de abrir (cozinha):**

1. Aba **Cozinha** → *Sabores* → cadastre os sabores (nome + **Add**).
2. *Lancar producao* → tipo **Carga inicial** → quantidade de cada sabor → **Lancar**.
3. No computador do caixa, aba **Caixa** → a faixa **VALOR DO PASTEL** fica no alto
   da tela. Digite o valor e clique em **Salvar valor**. Enquanto estiver vazia ela
   aparece em vermelho e os sabores ficam travados.

**Durante a venda (caixa):**

1. Aba **Caixa** → nome do comprador → forma de pagamento.
2. Toque no `+` de cada sabor. O card mostra quantos ainda tem; quando acaba,
   o sabor trava sozinho.
3. **Lancar pedido**. O numero do pedido aparece em destaque — e esse numero que
   o cliente leva para a cozinha.
4. Recebeu o dinheiro? Clique em **Pago?** na lista de pedidos recentes. O botao
   vira **Pagou** em verde.

**Na retirada (cozinha):**

1. Aba **Cozinha** → *Fila de retirada* → busque pelo numero ou pelo nome.
2. Levou tudo? Botao verde **Retirado**.
3. Levou so uma parte e volta depois? Botao ambar **Parcial** → informe quantos de
   cada sabor estao saindo agora → **Entregar**.

O pedido parcial continua na fila, com a tarja ambar e o aviso *faltam N*. Quando o
cliente voltar, use **Entregar o resto** (ou **Parcial** de novo, se levar em
etapas). **Desfazer entregas** zera tudo se alguem errar.

**Quem ainda nao pagou.** O botao **Pago?** (vermelho) aparece na tela do caixa, na
ficha da cozinha e na lista do admin — porque as vezes o cliente paga na venda e as
vezes so na retirada. Um clique marca; para desmarcar, o sistema pede confirmacao.
Na aba Inicio, o KPI **Ja recebido** mostra quanto entrou e quanto ainda falta.

**Fornada nova (cozinha):** *Lancar producao* → tipo **Producao** → quantidade →
**Lancar**. O caixa ve o estoque novo na hora.

**Vendidos por sabor (cozinha):** ao lado de *Lancar producao* fica o placar com o
numero de pasteis vendidos de cada sabor e o total. E so leitura — serve para a
cozinha decidir qual sabor entra na proxima fornada. Atualiza sozinho a cada pedido.


**Corrigir um pedido (caixa):** aba **Caixa** → *Pedidos recentes* → botao **Editar**
na linha do pedido. Da para trocar o nome do comprador, a forma de pagamento, a
observacao e a quantidade de cada sabor. Serve para o engano de balcao — "era 6,
nao 8", ou o nome que saiu errado. O pedido fica marcado como *editado* na lista,
e a planilha registra quem corrigiu e quando.

Tres coisas a edicao NAO faz, de proposito:

- **Nao muda o valor do pastel daquele pedido.** Cada venda guarda o preco do
  momento em que foi feita, senao o faturamento para de bater com a caixinha.
- **Nao reduz um sabor abaixo do que o cliente ja retirou.** Se ele levou 4 de
  carne, o minimo daquele sabor e 4 — o botao de diminuir simplesmente trava.
- **Nao desmarca um pedido pago.** Se o valor mudar num pedido ja pago, o sistema
  avisa na tela quanto era e quanto ficou, e o caixa decide como acertar.

Se o pedido estiver **cancelado**, o botao fica desligado: restaure primeiro.
Para apagar de vez, use a aba **Admin**.

**Tirar um sabor do ar (cozinha):** em *Sabores*, o botao **Off** some com
ele do caixa mas mantem o historico nos relatorios. O **×** apaga de vez, e so
funciona em sabor que nunca foi vendido nem teve producao lancada.

**Custos (admin):** aba **Custos** → descricao, categoria e valor → **Lancar custo**.
Vale para farinha, queijo, gas, embalagem, refrigerante. O **valor liquido**
(faturamento − custos) aparece na aba Inicio e na aba Custos, para todos os perfis.

**Corrigir um pedido (admin):** na aba **Admin**, cada pedido tem dois botoes.
**Cancelar** tira do faturamento e devolve os pasteis ao estoque, mas o pedido
continua na lista marcado como cancelado — bom quando voce quer o rastro. **Apagar**
remove de vez: some da lista e de todos os relatorios. Os dois pedem confirmacao, e
o Apagar mostra o pedido inteiro na pergunta antes de sumir.

**No fim do dia (admin):** aba **Admin** → *Extrair os dados*.

---

## Quando eu mudar o sistema

As telas ficam abertas o dia inteiro, entao um computador continua rodando a versao
que baixou de manha mesmo depois de o servidor ser atualizado. Para isso o sistema
avisa sozinho: quando a versao no servidor muda, aparece uma **tarja laranja** no
alto de cada tela com o botao **Atualizar agora**. Um clique recarrega.

Se alguem perder a tarja, `Ctrl` + `F5` no navegador resolve.

---

## Onde ficam os dados

Tudo mora dentro da pasta do projeto (a pasta `UMP-VENDAS`):

| Caminho                     | O que e                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `server/data/vendas.db`     | **o banco** — a fonte da verdade, com tudo dentro                   |
| `server/data/vendas.db-wal` | as gravacoes mais recentes, ainda nao dobradas no arquivo principal |
| `server/data/CODIGOS.txt`   | os tres codigos de acesso                                           |
| `backups/`                  | as planilhas `.xlsx` geradas sozinhas                               |

Os tres primeiros vivem juntos: para levar os dados de uma maquina para outra,
**copie a pasta `server/data` inteira**, nunca so o `vendas.db`. Hoje o arquivo
principal tem poucos KB e quase tudo esta no `-wal`; copiar so um deles devolve um
banco vazio. O `BACKUP.bat` ja cuida disso — ele junta o WAL antes de copiar.

---

## Backup automatico em Excel

O sistema grava sozinho uma planilha `.xlsx` na pasta `backups/`, com sete abas:
Resumo, Pedidos, Itens dos pedidos, Sabores, Estoque, Custos e Historico de precos.

Ela e gerada em tres momentos:

| Quando                                   | Nome do arquivo                    |
| ---------------------------------------- | ---------------------------------- |
| Ao desligar (Ctrl+C ou fechar a janela)  | `evento-...-desligamento.xlsx`     |
| A cada 10 minutos, se houver dado novo   | `evento-...-automatico.xlsx`       |
| Quando o admin clica em Planilha (Excel) | baixa direto, sem gravar em disco  |

**Por que os dois caminhos.** Fechar a janela avisa o sistema, e ele grava antes de
sair. Queda de energia ou "finalizar tarefa" no gerenciador **nao avisam ninguem** —
nesses casos o que salva e a copia periodica, e o maximo que se perde sao os ultimos
10 minutos. O banco em si (`server/data/vendas.db`) sobrevive a queda e continua
sendo a fonte da verdade; a planilha e a copia legivel para abrir no Excel.

Para mudar o intervalo: `BACKUP_MIN=5 npm start` (em minutos).

---

## Extrair os dados (aba Admin)

| Botao                 | O que sai                                                        |
| --------------------- | ---------------------------------------------------------------- |
| **Pedidos**           | um pedido por linha: itens, quantidade, quanto falta retirar, status, horarios |
| **Itens dos pedidos** | um sabor por linha — da para somar quanto cada sabor rendeu       |
| **Estoque**           | toda carga inicial, fornada e ajuste lancados                     |
| **Custos**            | as despesas por categoria                                         |
| **Resumo do evento**  | pedidos + custos + resultado liquido num arquivo so               |
| **Planilha (Excel)**  | arquivo .xlsx com 7 abas — o mesmo do backup automatico            |
| **Tudo (JSON)**       | o banco inteiro, para copia de seguranca ou outra ferramenta      |

Os CSV abrem direto no Excel (separador `;`, acentos certos). O JSON leva todas as
tabelas — sabores, pedidos, itens, estoque, custos e historico de precos — **menos os
codigos de acesso**, que ficam de fora de proposito.

---

## Decisoes que valem conhecer

**Um valor para todos os sabores, definido no caixa.** A faixa **VALOR DO PASTEL**
fica sempre visivel no alto da tela de venda, e sempre editavel. Vermelha enquanto
nao houver valor (o caixa nao vende), verde depois. So o caixa e o admin mexem nela —
a cozinha nao.

**O valor novo vale so para pedidos novos.** Quando o caixa troca o valor, a tela
recalcula na hora — mas cada venda ja lancada guarda o preco do momento. Assim o
faturamento do sistema bate com o dinheiro que entrou na caixinha.

**Comprar e reservar.** Ao lancar o pedido, os pasteis saem do disponivel
imediatamente, mesmo antes de serem retirados. E por isso que o caixa nunca vende
mais do que existe. A retirada (total ou parcial) nao mexe mais no estoque — ela so
registra o que ja saiu fisicamente da cozinha.

**O status do pedido vem das quantidades, nao de um clique.** Nada entregue =
*Aguardando*; parte entregue = *Parcial*; tudo entregue = *Retirado* (verde). Nao
da para "marcar como retirado" um pedido que ainda tem pastel pendente sem entregar
o restante.

**Custos nao mexem no caixa, so no resultado.** O faturamento continua sendo a soma
das vendas; o liquido e faturamento menos custos. Se os custos ainda estiverem acima
das vendas (comum no comeco do dia), o liquido aparece em vermelho.

**Cancelar guarda o rastro, Apagar nao.** So o admin faz os dois. Cancelar tira do
faturamento e devolve os pasteis, mantendo o pedido na lista como cancelado. Apagar
remove de vez — use quando foi engano de digitacao e o registro nao deve existir.

**Numero de pedido nunca se repete.** O contador so cresce. Se voce apagar o pedido
#7, o proximo continua sendo #8 — dois pedidos diferentes nunca carregam o mesmo
numero no mesmo evento.

**As duas telas ficam sempre iguais.** O servidor empurra o estado completo para
todos os navegadores a cada mudanca. Se a rede cair, o navegador reconecta sozinho
(o indicador no topo mostra *ao vivo* ou *reconectando*) e volta ja atualizado.

**Um perfil por navegador.** A sessao fica salva no navegador, entao a mesma janela
nao consegue estar como caixa e cozinha ao mesmo tempo. Como cada perfil fica em um
computador, isso nao atrapalha — se precisar dos dois na mesma maquina, use uma
janela anonima para o segundo.

---

## Identidade visual

O verde do sistema (`#4e685d`) foi amostrado do proprio logo da IPSAT. O preto
geometrico da UMP entra nos textos e numeros. Os dois logos ficam juntos no canto
superior esquerdo e tambem na tela de entrada.

- Cores: [`web/src/theme.css`](web/src/theme.css) — mexa so nos `--brand-*` e no
  `--accent`; cabecalho, abas, botoes, KPIs e destaques seguem esses valores.
- Logos: `web/public/logo-ump.png` e `web/public/logo-ipsat.png`. Para trocar por
  uma arte nova, substitua o arquivo mantendo o nome.

Depois de qualquer mudanca:

```bash
npm run build
```

## Tela cheia, sem rolagem

Cada tela ocupa a altura toda da janela e **a pagina nao rola**. As listas nao sao
cortadas num numero fixo: o sistema mede a area que sobrou, calcula quantas linhas
(ou quantos cartoes) cabem e pagina exatamente nisso. Se voce mudar o tamanho da
janela ou usar um monitor menor, a conta refaz sozinha.

No celular nao da para encaixar duas colunas de painel em 375px sem esconder coisa,
entao as colunas viram uma so e o **miolo** passa a rolar — a pagina em si continua
fixa, sem o solavanco de rolar o documento inteiro.

---

## Dia do evento: checklist

- [ ] Servidor ligado na tomada, sem modo de suspensao (Windows: Configuracoes →
      Sistema → Energia → "Nunca" suspender)
- [ ] Os dois computadores na **mesma rede** (mesmo Wi-Fi ou mesmo cabo)
- [ ] `INICIAR.bat` rodando e a janela preta **aberta** (fechar ela derruba o sistema)
- [ ] Testou o endereco no computador do caixa antes de abrir a fila
- [ ] Valor unitario e carga inicial ja lancados
- [ ] Codigos anotados em papel

**Se o Windows Firewall perguntar**, marque *Redes privadas* e permita o acesso —
sem isso o outro computador nao enxerga o servidor.

---

## Perguntas rapidas

**O caixa ficou "reconectando".** O servidor caiu ou a rede oscilou. Confira se o
terminal ainda esta rodando. Assim que voltar, a tela se atualiza sozinha — nenhum
pedido se perde, tudo fica gravado no servidor.

**Preciso reiniciar o servidor.** Pode. Feche a janela preta e abra o `INICIAR.bat`
de novo. Os dados ficam no arquivo do banco, nada se perde.

**Quero usar outra porta.** `INICIAR.bat 8080` (ou `PORT=8080 npm start` no terminal).

**Fazer uma copia de seguranca durante o evento.** Duplo clique em `BACKUP.bat`,
sem precisar parar o sistema. Gera um arquivo em `backups/`.

**Conferir se esta tudo funcionando.** `npm test` sobe uma copia do sistema num banco
temporario e testa as regras (estoque, preco, permissoes, KPIs, baixa, cancelamento)
sem encostar nos dados reais. Vale rodar depois de instalar no computador da igreja.

**Comecar um novo evento do zero.** Aba **Admin** → **Zerar evento**.
Apaga pedidos, estoque e custos; mantem sabores, codigos e valor unitario.
**Baixe o CSV antes** — nao da para desfazer.

---

## Para quem for mexer no codigo

```
server/
  index.js          Express: API, arquivos estaticos e canal SSE
  db.js             Banco SQLite (node:sqlite, sem dependencia nativa) e schema
  auth.js           Codigo de acesso -> token HMAC -> perfil
  state.js          Monta o retrato completo (estoque, KPIs, pedidos)
  events.js         Envia o retrato para todos os navegadores a cada mudanca
  routes/           auth, orders (inclui retirada parcial), kitchen, admin (inclui custos)
  public/           frontend compilado (gerado por npm run build)
web/src/
  App.jsx           Abas por perfil
  theme.css         <- identidade visual
  components/       Marca (logos), Kpi, Toast, Paginacao
  screens/          Login, Dashboard, Caixa, Cozinha, Custos, Admin
```

Durante o desenvolvimento, em dois terminais:

```bash
npm run dev:server
```

```bash
npm run dev:web
```

O Vite sobe em `http://localhost:5173` com recarga automatica e repassa `/api` e
`/events` para o servidor na 3000.

**Stack:** Node 22+ (SQLite embutido), Express, React + Vite, Server-Sent Events.
Sem banco externo, sem modulo nativo para compilar, sem Docker.
