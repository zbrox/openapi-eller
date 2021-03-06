import { find, values } from "lodash"
import { 
  OpenApiGenTree,
  Target,
  ConfigObject,
  TargetEndpointsGroup,
  OpenApiGenSchema,
  EndpointIteration
} from "types"
import {
  ResponseObject,
  ResponsesObject
} from "openapi3-ts"

import { resolveSchemaType } from "./targets"

const VALID_HTTP_METHODS = [
  "get", "put", "post", "delete", "options", "head", "patch", "trace"
]

export function endpointIterator(tree: OpenApiGenTree) {
  return function* endpointIterator() {
    for (const routePath in tree.paths) {
      const pathObject = tree.paths[routePath]

      for (const httpMethod in pathObject) {
        const operationObject = pathObject[httpMethod]

        if (!VALID_HTTP_METHODS.includes(httpMethod)) {
          continue
        }

        const ret: EndpointIteration = {
          routePath, pathObject, httpMethod, operationObject
        }
        
        yield ret
      }
    }
  }()
}

function findResponseSchema(responses: ResponsesObject) {
  const successResponse: ResponseObject = find(
    responses, 
    (responseObject: ResponseObject, statusCode) => {
      const statusCodeInt = parseInt(statusCode, 10)

      if (Number.isNaN(statusCodeInt)) {
        return false
      }

      return statusCodeInt >= 200 && statusCodeInt <= 299
    })
  
  if (!successResponse || !successResponse.content) {
    return
  }

  const firstObject = find(successResponse.content)

  if (firstObject && firstObject.schema != null) {
    return firstObject.schema as OpenApiGenSchema
  }
}

export function generateEndpoints(
  tree: OpenApiGenTree, 
  target: Target, 
  config: ConfigObject
): TargetEndpointsGroup[] | null {
  const isGroupingEnabled = config.useGroups || false
  const groups: {[groupName: string]: TargetEndpointsGroup} = {}

  for (const { routePath, httpMethod, operationObject } of endpointIterator(tree)) {
    if (config && config.include) {
      if (!operationObject.tags) {
        continue
      }

      const include = config.include
      if (!operationObject.tags.find((tag: string) => include.indexOf(tag) > -1)) {
        continue
      }
    }

    // Group routes by first tag if grouping is enabled
    const group = isGroupingEnabled && operationObject.tags
      ? target.cls(operationObject.tags[0])
      : ""
    
    if (!operationObject.responses) {
      throw new Error(`No responses field found for ${JSON.stringify(operationObject)}`)
    }

    let responseSchema
    try {
      responseSchema = findResponseSchema(operationObject.responses) || null
    } catch (err) {
      throw new Error(`Invalid response found for ${JSON.stringify(operationObject)}`)
    }

    if (!operationObject.operationId && !operationObject.summary) {
      // tslint:disable-next-line:max-line-length
      throw new Error(`No operationId or summary found for route: ${JSON.stringify(operationObject)}`)
    }
    const operationId = target.operationId(operationObject)
    const anonymousReqBodyName = `${target.cls(operationId)}Body`
    const anonymousResponseName = `${target.cls(operationId)}Response`
    const schemaType = resolveSchemaType(target, responseSchema, anonymousResponseName)
    const returnType = target.returnType(schemaType)

    if (!groups[group]) {
      groups[group] = {
        name: group,
        endpoints: []
      }
    }

    const operationParams = target.operationParams(operationObject, anonymousReqBodyName)
    const opParamDefaults = target.operationParamsDefaults(operationObject, anonymousReqBodyName)
      || operationParams

    groups[group].endpoints.push({
      operationId,
      returnType,
      httpMethod: target.httpMethod(httpMethod),
      url: target.pathUrl(routePath),
      // TODO: reimplement per-endpoint security handling
      // security: target.security
      //     ? target.security(operationObject.security || [])
      //     : null,
      operationParams,
      operationParamsDefaults: opParamDefaults,
      operationArgs: target.operationArgs(operationObject, anonymousReqBodyName),
      operationKwargs: target.operationKwargs(operationObject, anonymousReqBodyName),
      requestParams: target.requestParams(operationObject, anonymousReqBodyName)
    })
  }

  return values(groups)
}
