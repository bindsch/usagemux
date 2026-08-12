.PHONY: install link unlink test coverage typecheck check

install:
	bun install --frozen-lockfile

link:
	bun link
	chmod 755 bin/usagemux

unlink:
	bun unlink

test:
	bun test

coverage:
	bun test --coverage

typecheck:
	bun run typecheck

check: typecheck test
	sh -n bin/usagemux
