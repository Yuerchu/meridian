import './project-icon.css'
import { FolderOpen, User, Users } from '@keyline-icons/react/two-tone'

/** A project is either a directory on disk or a QQ conversation it mirrors. */
export function ProjectIcon({ sourceType }: { sourceType: string }) {
  switch (sourceType) {
    case 'onebot_private':
      return <User className="m-project-icon" />
    case 'onebot_group':
      return <Users className="m-project-icon" />
    default:
      return <FolderOpen className="m-project-icon" />
  }
}
