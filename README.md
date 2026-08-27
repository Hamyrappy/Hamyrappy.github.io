# Hamyrappy.github.io

Архив страниц с постоянными адресами. Отдаётся GitHub Pages на
`https://hamyrappy.github.io/` и не зависит ни от домена, ни от сервера — только
от того, что этот репозиторий публичный и называется так, как называется.

Что здесь лежит:

- `drift-inspector/` — лендинг статьи «Drift Inspector» (EMNLP 2026, System
  Demonstrations). **Этот адрес напечатан в статье, менять его нельзя.**
- `drift-inspector-acl/`, `drift-inspector-emnlp/` — живые демо-инстансы.
- `drift-inspector-airi-210f/` — инстанс без публичной ссылки, с `noindex`.
- `metalcrow/` — лендинг проекта MetalCrow.

Первые три папки **правятся не здесь**: их копирует сюда GitHub Actions
`deploy-inspector.yml` из репозитория `Hamyrappy/atomic-contribution-claims`
командой `rsync --delete`, поэтому любая ручная правка в них будет молча стёрта
следующим прогоном. Источник — `landing/` и `inspector/` в том репозитории.

Живой личный сайт переехал на `hamyrappy.com` (приватный репозиторий
`Hamyrappy/hamyrappy-com`, отдаётся с сервера gornilo). Корень этого репозитория
и `shoggoth/` — страницы-указатели, которые уводят туда.

Файл `CNAME` здесь заводить нельзя, он внесён в `.gitignore`: кастомный домен на
пользовательском сайте GitHub Pages уводит на себя ВЕСЬ хост, включая адрес,
напечатанный в статье.
