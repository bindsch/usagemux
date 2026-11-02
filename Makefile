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

check: typecheck
	mkdir -p coverage
	rm -f coverage/lcov.info coverage/.run-stamp coverage/.lcov.info.*.tmp
	touch coverage/.run-stamp
	bun test --coverage --coverage-reporter=lcov --coverage-dir="$(CURDIR)/coverage"
	bun scripts/check-source-coverage.ts
	sh -n bin/usagemux
