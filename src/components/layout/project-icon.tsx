import { FolderOpen, User, Users } from '@keyline-icons/react/two-tone'

/** A project is either a directory on disk or a QQ conversation it mirrors. */
export function ProjectIcon({ sourceType }: { sourceType: string }) {
  switch (sourceType) {
    case 'onebot_private':
      return <User className="size-4" />
    case 'onebot_group':
      return <Users className="size-4" />
    default:
      return <FolderOpen className="size-4" />
  }
}
