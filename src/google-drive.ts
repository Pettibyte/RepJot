import { randomUuid } from './random-uuid';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const FILE_NAME = 'hello-world.json';

export interface HelloWorldDocument {
  helloWorld: string;
}

interface DriveFile {
  id: string;
  name: string;
}

interface FileListResponse {
  files?: DriveFile[];
}

interface AboutResponse {
  user?: {
    permissionId?: string;
    displayName?: string;
  };
}

export interface DriveAccount {
  accountKey: string;
  displayName?: string;
}

export class DriveHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'DriveHttpError';
    this.status = status;
  }
}

function authorization(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

async function driveFetch<T>(url: string, init: RequestInit, context: string): Promise<T> {
  const response: Response = await fetch(url, init);
  if (!response.ok) {
    const details: string = await response.text();
    throw new DriveHttpError(
      `${context} failed (${response.status}): ${details || response.statusText}`,
      response.status
    );
  }
  return (await response.json()) as T;
}

function isHelloWorldDocument(value: unknown): value is HelloWorldDocument {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return 'helloWorld' in value && typeof value.helloWorld === 'string';
}

export async function getDriveAccount(accessToken: string): Promise<DriveAccount> {
  const parameters = new URLSearchParams({ fields: 'user(permissionId,displayName)' });
  const result = await driveFetch<AboutResponse>(
    `${DRIVE_API}/about?${parameters.toString()}`,
    { headers: authorization(accessToken) },
    'Binding the Google Drive account'
  );
  const accountKey = result.user?.permissionId;
  if (accountKey === undefined || accountKey.length === 0) {
    throw new Error('Google Drive did not return an account key.');
  }
  return {
    accountKey,
    ...(result.user?.displayName === undefined ? {} : { displayName: result.user.displayName })
  };
}

export async function findHelloWorldFile(accessToken: string): Promise<DriveFile | null> {
  const parameters: URLSearchParams = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${FILE_NAME}' and trashed = false`,
    fields: 'files(id,name)',
    pageSize: '1'
  });
  const result: FileListResponse = await driveFetch<FileListResponse>(
    `${DRIVE_API}/files?${parameters.toString()}`,
    { headers: authorization(accessToken) },
    'Looking up the app-data file'
  );
  return result.files?.[0] ?? null;
}

export async function readHelloWorld(
  accessToken: string,
  fileId: string
): Promise<HelloWorldDocument> {
  const document: unknown = await driveFetch<unknown>(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: authorization(accessToken) },
    'Reading the app-data file'
  );
  if (!isHelloWorldDocument(document)) {
    throw new Error('The stored file is not a valid hello-world document.');
  }
  return document;
}

export async function createHelloWorld(
  accessToken: string,
  document: HelloWorldDocument
): Promise<DriveFile> {
  const boundary = `repjot_${randomUuid()}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' }),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(document),
    `--${boundary}--`,
    ''
  ].join('\r\n');

  return driveFetch<DriveFile>(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name`,
    {
      method: 'POST',
      headers: {
        ...authorization(accessToken),
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    },
    'Creating the app-data file'
  );
}

export async function deleteHelloWorld(accessToken: string, fileId: string): Promise<void> {
  const response: Response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: authorization(accessToken)
  });
  if (!response.ok) {
    const details: string = await response.text();
    throw new DriveHttpError(
      `Deleting the app-data file failed (${response.status}): ${details || response.statusText}`,
      response.status
    );
  }
}

export async function updateHelloWorld(
  accessToken: string,
  fileId: string,
  document: HelloWorldDocument
): Promise<void> {
  const response: Response = await fetch(
    `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        ...authorization(accessToken),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(document)
    }
  );
  if (!response.ok) {
    const details: string = await response.text();
    throw new DriveHttpError(
      `Saving the app-data file failed (${response.status}): ${details || response.statusText}`,
      response.status
    );
  }
}
