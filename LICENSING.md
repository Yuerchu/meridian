# Licensing

Meridian is dual-licensed.

## Open-Source License

The source code in this repository is licensed under the
**GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later).
See [LICENSE](LICENSE) for the full text.

You are free to use, modify and redistribute Meridian under the terms of
the AGPL. In particular, if you modify Meridian and make it available over
a network, you must release the complete source code of your modified
version under the same license.

## Commercial License

If the AGPL does not meet your needs — for example, you want to embed
Meridian in a proprietary product, offer it as a hosted service without
publishing your modifications, or you need a warranty or indemnification —
a commercial license is available from the copyright holder.

Contact: **admin@yuxiaoqiu.cn**

## Yuerchu UI components (not AGPL)

> **Draft — not yet in force.**

The user-interface components under `src/components/yuerchu-ui/` are synced
from @yuerchu/ui, a separate component library by the same author. They are
**not** covered by the AGPL. They are source-available under the
[Yuerchu UI License](LICENSES/LicenseRef-Yuerchu-UI.txt):

- you may read, build, modify and distribute them **as part of Meridian**,
  including your own fork or modified version of Meridian;
- you may **not** extract them into another application or product, or
  distribute them as a component library, design system or UI kit.

The design system they are built on — the design tokens
(`src/components/yuerchu-ui/styles/tokens.css`) and the design rules
(`src/components/yuerchu-ui/DESIGN.md`) — is licensed under the
[MIT License](LICENSES/MIT.txt) and may be used anywhere.

Only the components Meridian actually uses are synced into this
repository; the rest of @yuerchu/ui is not published.

If you want a Meridian that is AGPL from top to bottom, replace the
contents of `src/components/yuerchu-ui/` with your own components. The
rest of the frontend and the whole backend remain available to you under
the AGPL. `REUSE.toml` records which license covers which path.

### Additional permission under GNU AGPL version 3 section 7

If you modify this Program, or any covered work, by linking or combining
it with the Yuerchu UI components (the files that `REUSE.toml` marks as
`LicenseRef-Yuerchu-UI`, or a modified version of them), containing parts
covered by the terms of the Yuerchu UI License, the licensors of this
Program grant you additional permission to convey the resulting work.
Corresponding Source for a non-source form of such a combination shall
include the source code for the parts of the Yuerchu UI components used as
well as that of the covered work.

This permission does not relicense the Yuerchu UI components: they remain
under their own license. You may remove this additional permission from
your own copies of Meridian, as section 7 allows; you then also have to
remove the Yuerchu UI components.

## Third-Party Components

Meridian depends on [meridian-core](https://github.com/Yuerchu/meridian-core),
which is independently licensed under **Apache-2.0**. The Apache-2.0 license
is compatible with the AGPL and does not impose additional restrictions on
your use of meridian-core by itself.

See [NOTICE](NOTICE) for attribution of third-party code incorporated into
this project.

## Contributor License Agreement

To preserve the ability to offer commercial licenses, all contributions to
this repository require a Contributor License Agreement (CLA). By submitting
a pull request you agree to the terms of the [Individual CLA](.github/CLA.md).
This does **not** transfer your copyright — you retain full ownership of your
contribution — but it grants the project the right to distribute your work
under both the AGPL and commercial licenses.
