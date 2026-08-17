import { FolderOpen, Person, Persons } from '@gravity-ui/icons'

/** A project is either a directory on disk or a QQ conversation it mirrors. */
export function ProjectIcon({ sourceType }: { sourceType: string }) {
  switch (sourceType) {
    case 'onebot_private':
      return <Person />
    case 'onebot_group':
      return <Persons />
    default:
      return <FolderOpen />
  }
}
