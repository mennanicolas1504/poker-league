# Quinta Flush

Site do campeonato de poker do grupo. Qualquer jogador pode lançar o resultado
do dia direto pelo site — acabou a planilha manual. Os dados ficam guardados
no Firebase (grátis) e a classificação é recalculada sozinha, em tempo real,
pra todo mundo que estiver vendo a página.

## O que tem aqui

- `index.html`, `style.css`, `app.js` — o site em si.
- `firebase-init.js` — conecta o site ao Firebase (não precisa mexer).
- `firebase-config.js` — **é aqui que você cola as suas chaves do Firebase.**
- `firestore.rules` — regras de acesso do banco de dados.
- `seed.json` + `import.html` — importador com as 17 etapas que já estavam
  na sua planilha `Poker .xlsx`, pra você não perder o histórico.

## Passo 1 — Criar o projeto no Firebase (grátis)

1. Acesse [console.firebase.google.com](https://console.firebase.google.com) e faça login com sua conta Google.
2. Clique em **Adicionar projeto**, dê um nome (ex: `poker-league`) e finalize a criação.
3. No menu lateral, vá em **Compilação > Firestore Database** → **Criar banco de dados** → escolha uma região (ex: `southamerica-east1`) → inicie em **modo de produção**.
4. Ainda no menu lateral, vá em **Compilação > Authentication** → **Vamos começar** → na lista de provedores, ative **Anônimo**. (Isso deixa qualquer pessoa que abrir o site "logada" automaticamente, sem precisar criar conta nem senha — é só o que permite que qualquer jogador consiga lançar um resultado.)
5. Clique na engrenagem ao lado de "Visão geral do projeto" → **Configurações do projeto** → aba **Geral** → role até "Seus apps" → clique no ícone **</>** (Web) → dê um apelido (ex: `poker-site`) → **Registrar app**.
6. O Firebase vai mostrar um bloco `firebaseConfig = { ... }`. Copie esses valores.

## Passo 2 — Colar as chaves no projeto

Abra o arquivo `firebase-config.js` e substitua os valores de exemplo pelos que
você copiou no passo anterior. Fica assim:

```js
export const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "poker-league-xxxxx.firebaseapp.com",
  projectId: "poker-league-xxxxx",
  storageBucket: "poker-league-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456",
};
```

Essas chaves não são segredo, pode deixar no código e subir pro GitHub sem
problema — quem protege o banco são as regras do próximo passo.

## Passo 3 — Publicar as regras do Firestore

1. No console do Firebase, vá em **Firestore Database > Regras**.
2. Apague o conteúdo e cole o conteúdo do arquivo `firestore.rules` deste projeto.
3. Clique em **Publicar**.

## Passo 4 — Testar localmente antes de publicar

Como o site usa módulos JavaScript (`import`/`export`), não dá pra simplesmente
abrir o `index.html` clicando duas vezes — o navegador bloqueia por segurança.
Duas formas fáceis de testar no seu computador:

- **No VS Code:** instale a extensão "Live Server", clique com o botão direito
  em `index.html` e escolha **Open with Live Server**.
- **Sem VS Code:** com o Node instalado, rode `npx serve` na pasta do projeto
  e abra o link que aparecer (algo como `http://localhost:3000`).

## Passo 5 — Importar o histórico da planilha antiga

Com o site rodando localmente (passo 4), acesse `import.html` (ex:
`http://localhost:3000/import.html`) e clique em **Importar dados da
planilha**. Isso manda as 17 etapas que já estavam no `Poker .xlsx` pro
Firestore, de uma vez só. Pode rodar essa página de novo sem medo: etapas que
já existirem não são duplicadas.

> **Duas coisas que eu ajustei ao importar, vale saber:**
> - Nomes com espaços extras na planilha (ex: `"Vitor "`, `"Tetéu "`) foram
>   padronizados para o mesmo nome do resto (`"Vitor"`, `"Tetéu"`).
> - A aba "Geral" da planilha antiga estava com alguns totais desatualizados
>   em relação à aba "Etapas" — por exemplo, o Arthur aparecia com 20 pontos
>   na aba Geral, mas somando etapa por etapa dá 44 pontos; Mano, Buss e VH
>   tinham a contagem de "etapas jogadas" um pouco diferente do que a aba
>   Etapas mostra. O site novo sempre calcula tudo a partir do resultado de
>   cada etapa, então isso não vai mais acontecer — a classificação fica
>   sempre coerente com o que foi lançado.

Depois de importar, você pode apagar `import.html`, `import.js` e `seed.json`
do repositório (ou só deixar — eles não aparecem em lugar nenhum do site
principal).

## Passo 6 — Publicar no GitHub Pages

```bash
git init
git add .
git commit -m "Site do campeonato de poker"
```

Crie um repositório novo no GitHub (pode ser público) e conecte:

```bash
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git branch -M main
git push -u origin main
```

No GitHub: **Settings > Pages** → em "Build and deployment", escolha
**Deploy from a branch** → branch `main`, pasta `/ (root)` → **Save**.
Em alguns minutos o site fica disponível em
`https://SEU-USUARIO.github.io/SEU-REPOSITORIO/`. Manda esse link pro grupo!

## Como o pessoal vai usar no dia a dia

- Qualquer um abre o link e vê a classificação, o histórico das etapas e o
  perfil de cada jogador em tempo real.
- Só o admin lança, edita ou exclui resultado, e marca alguém como
  convidado: ao clicar em **+ Lançar resultado**, **Editar esta etapa**,
  **Excluir etapa** ou no 🎟️, o site pede uma senha (hoje `1504`, constante
  `ADMIN_PIN` no `app.js`) — depois de acertar uma vez, fica liberado até
  fechar a aba. É só uma trava de interface contra clique errado, não é
  segurança de verdade (veja a observação abaixo).
- A premiação (o valor em destaque no canto) tem sua própria senha, hoje
  `poker2026` (constante `ORG_PIN`) — mesma ideia, é só uma trava simples.

## Sobre segurança (seja honesto com o grupo sobre isso)

As senhas do admin e da premiação são conferidas no JavaScript que roda no
navegador de quem está vendo o site — servem pra evitar que alguém mexa por
engano ou de brincadeira clicando nos botões normais, mas não travam a
gravação no banco: as regras do Firestore (`firestore.rules`) ainda deixam
**qualquer pessoa que abrir o site** escrever ali (é o login anônimo
automático), então alguém com conhecimento técnico (abrindo o console do
navegador, por exemplo) conseguiria contornar a senha. Funciona bem pra um
grupo de amigos com o link fechado entre vocês. Se um dia isso virar um
problema de verdade, me chama que a gente troca esse esquema por um login
de verdade (ex: cada jogador com e-mail/senha, ou as regras do Firestore já
exigindo o PIN do admin pra escrever).

## Trocar a paleta / visual

As cores principais estão como variáveis no topo do `style.css` (bloco
`:root`), então dá pra mudar o dourado, o fundo etc. mexendo só ali.
