# mifplace (prototype)

A shared pixel canvas. This archive is a prebuilt release for running locally: the server and the
web page work on your machine only, there is no remote server.

## Requirements

* Node.js 24 or newer (`node --version`)
* Internet access for the first `npm ci` (it downloads the dependencies)

## Run

Install the dependencies in the folder of the archive, then run the rest from the `backend`
folder: the server looks for `../frontend/dist` and the database relative to it.

```
npm ci --omit=dev
cd backend
cp .env.example .env        # Windows (cmd): copy .env.example .env
npm run db:setup:prod       # creates data/mifplace.db and applies the migrations
npm start
```

Open http://127.0.0.1:3000 in the browser.

## Use

* Click a cell on the canvas, a colour picker appears.
* Click a colour to preview it, click the same colour again to place the pixel.
* A click outside the picker or Escape cancels.
* The slider changes the zoom.

## Settings

`backend/.env` (the commented lines show the defaults):

* `PORT`, `HOST`: where the server listens (`3000`, `127.0.0.1`)
* `DB_PATH`: SQLite file (`./data/mifplace.db`)
* `MIGRATIONS_DIR`: not needed, the migrations are part of the archive (`db/migrations`)

To start with an empty canvas, stop the server and delete the `backend/data` folder, then run
`npm run db:setup:prod` again.

## Not in this version

Real-time updates for other users, sign-in and the cooldown between pixels are not implemented yet.
