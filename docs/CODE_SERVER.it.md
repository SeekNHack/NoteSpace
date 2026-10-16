# Prova NoteSpace su code-server

1. Apri la cartella del progetto in code-server e usa **Developer: Reload Window** dopo aver installato o aggiornato la VSIX.
2. Clicca l'icona del libro **NoteSpace** nella barra laterale. La configurazione di questo repository mostra già `examples/wiki`.
3. Per una nuova wiki, apri una cartella di lavoro ed esegui **NoteSpace: Create Wiki**. La procedura guidata crea `wiki.yaml`, `docs/`, `assets/` e la pagina iniziale.
4. Apri una pagina dall'Explorer di NoteSpace: si apre nello Studio visuale. Il selettore **Studio / Code / Split** nell'intestazione della pagina (oppure **Ctrl+Alt+E**, i pulsanti nel titolo dell'editor o la voce nella barra di stato) passa all'editor Markdown nativo o alla vista affiancata, nella stessa scheda e senza perdere modifiche non salvate. Digita `/` per inserire blocchi, `[[` per collegare pagine, **Ctrl+K** per i link e **Ctrl+clic** per seguirli. **Open Reader Preview** apre il lettore; **Open Dashboard** (**Ctrl+Alt+H**) apre il cruscotto.
5. Dal pannello laterale puoi creare sezioni e pagine, rinominarle, spostarle, duplicarle, eliminarle nel cestino interno e modificare le proprietà. **Validate Wiki** mostra collegamenti e immagini locali problematici.
6. **Build Wiki** genera il sito nella directory `build.output` del progetto; **Export Wiki to HTML** crea una copia in una cartella scelta. Per provare la ricerca del sito, servilo con un normale server HTTP statico.

Installazione manuale dalla directory del progetto:

```sh
npm ci
npm run package
code-server --install-extension notespace-1.0.0.vsix --force
```

L'estensione gira nell'extension host del server. Non richiede un servizio aggiuntivo né porte dedicate. Le webview richiedono HTTPS o localhost e un proxy compatibile con WebSocket e service worker. Gli output vengono scritti sul filesystem del server; puoi scaricarli dall'Explorer di code-server.

Il test automatico usa un'istanza isolata e non modifica quella in cui lavori:

```sh
npm run test:code-server
```

Per sintassi non preservabile dall'editor visuale (per esempio HTML, commenti, include o contenitori annidati) la pagina si apre in Code; aperta esplicitamente nello Studio viene mostrata in sola lettura con il pulsante **Edit in Code**. Consulta [editor-design.md](editor-design.md) e [testing.md](testing.md) per i limiti verificati.
