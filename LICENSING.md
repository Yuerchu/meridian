# Licensing

Meridian is dual-licensed.

## Open-Source License

The source code in this repository is licensed under the
**GNU Affero General Public License v3.0 or later** (AGPL-3.0-or-later),
except for the files under `src/components/yuerchu-ui/` (see
[Yuerchu UI](#yuerchu-ui) below). See [LICENSE](LICENSE) for the full text.

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

A commercial license for Meridian does not by itself cover the files under
`src/components/yuerchu-ui/` (see [Yuerchu UI](#yuerchu-ui)); their use outside
the AGPL is negotiated separately.

## Third-Party Components

Meridian depends on [meridian-core](https://github.com/Yuerchu/meridian-core),
which is independently licensed under **Apache-2.0**. The Apache-2.0 license
is compatible with the AGPL and does not impose additional restrictions on
your use of meridian-core by itself.

See [NOTICE](NOTICE) for attribution of third-party code incorporated into
this project.

## Yuerchu UI

The files under `src/components/yuerchu-ui/` are copied from the Yuerchu UI
component library and are **not** licensed under the AGPL:

- `styles/tokens.css` and `lib/motion-tokens.ts` are under the MIT license
  ([LICENSES/MIT.txt](LICENSES/MIT.txt)).
- Every other file there is under the Yuerchu UI License 1.1 (Meridian
  Edition) ([LICENSES/LicenseRef-Yuerchu-UI.txt](LICENSES/LicenseRef-Yuerchu-UI.txt)):
  source-available, usable, modifiable and redistributable only as part of
  Meridian or a work based on Meridian, including forks.

### Additional permission under AGPL-3.0 section 7

As an additional permission under section 7 of the GNU Affero General Public
License version 3, the copyright holder of Meridian gives you permission to
convey a covered work together with, and combined with, the files under
`src/components/yuerchu-ui/`, even though those files are licensed under the
terms above rather than under the AGPL, provided that you comply with those
terms for those files. The source code of those files, which is included in
this repository, is part of the Corresponding Source of any covered work that
uses them.

When you convey a modified version of Meridian, you may extend this permission
to your version. If you remove it, you may no longer convey your version
together with those files; removing them and replacing them with other code is
always allowed.

## Contributor License Agreement

To preserve the ability to offer commercial licenses, all contributions to
this repository require a Contributor License Agreement (CLA). By submitting
a pull request you agree to the terms of the [Individual CLA](.github/CLA.md).
This does **not** transfer your copyright — you retain full ownership of your
contribution — but it grants the project the right to distribute your work
under both the AGPL and commercial licenses.
